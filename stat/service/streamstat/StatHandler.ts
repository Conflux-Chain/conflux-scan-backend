import {StatApp} from "../../StatApp";
import {RedisStreamMessage, RedisWrap} from "../RedisWrap";
import {StatMessage} from "./StatMessage";
import {BizStatInfo} from "./BizStatInfo";
import {StatBucket} from "./StatBucket";
import {Epoch} from "../../model/Epoch";
import {Op} from "sequelize";
import {idHex40Map} from "../../model/HexMap";
import {format} from "js-conflux-sdk";
import {sleep} from "../tool/ProcessTool";
import {FullBlock} from "../../model/FullBlock";
const lodash = require('lodash');

export abstract class StatHandler {
    protected dbLocked = false;
    protected needWarmup = false;
    protected bizQueue: string;
    protected bizStatInfo: BizStatInfo;
    protected app: any;

    protected cacheStatInfo: any = {};

    protected constructor(app: StatApp) {
        this.app = app;
    }

    public async schedule(delay = 1000 * 60 * 3) {
        if(this.needWarmup){
            await this.warmUp({reservedBuckets: this.reservedBuckets()});
            console.log(`[type=${this.bizAlias()}]stream_stat_warmUp finished`);
        }
        await this.listen();

        const that = this
        async function repeat() {
            await that.awaitCollect().catch(err => {
                console.log(`[type=${that.bizAlias()}]stream_stat_collect fail: `, err);
            });
            setTimeout(repeat, delay);
        }

        repeat().then();
        console.log(`[type=${this.bizAlias()}]schedule stream_stat_collect service in 1s interval`);
    }

    protected async listen() {
        return RedisWrap.listenStreamMessage(this.bizQueue, (data) => this.handle(data));
    }

    protected async handle(data: RedisStreamMessage[]) {
        for (const item of data) {
            const message = item.message as StatMessage;
            const epochNumber = message.epochNumber;

            if(epochNumber && (epochNumber % 100 === 0)){
                console.log(`[q=${this.bizQueue}]handleStat msg:${JSON.stringify(message)}`);
            }

            if(!message.epochTimestamp){
                const block = await FullBlock.findOne({where: {epoch: epochNumber, pivot: true}, raw: true});
                if(!block) continue;
                message.epochTimestamp = block.createdAt;
            }
            const epochTimestamp = new Date(message.epochTimestamp);

            const action = message.action;
            if (action === 'push') {
                await this.stat({epochNumber, epochTimestamp, message});
                this.bizStatInfo.counter({epochNumber, epochTimestamp});
            }
            if (action === 'pop') {
                await this.revoke({epochNumber, epochTimestamp, message});
            }
        }
        return RedisWrap.xDel(data);
    }

    protected async stat({epochNumber, epochTimestamp, message}): Promise<any> {
        const statInfo = message.statInfo;
        for (const statId of Object.keys(statInfo)) {
            const bucket = await this.checkoutBucket({statId, statTime: epochTimestamp});
            bucket.increase({epochNumber, valArray: statInfo[statId]});
            await this.awaitRollupBucket({statId, bucketArray: [bucket], reservedBuckets: 0});
        }
    }

    protected async revoke({epochNumber, epochTimestamp, message}): Promise<any> {
        const statInfo = message.statInfo;
        for (const statId of Object.keys(statInfo)) {
            const bucket = await this.checkoutBucket({statId, statEpoch: epochNumber});
            bucket.decrease({epochNumber, valArray: statInfo[statId]});
            await this.awaitRollupBucket({statId, bucketArray: [bucket], reservedBuckets: 0});
        }
    }

    protected async checkoutBucket({statId, statTime = undefined, statEpoch = undefined}): Promise<StatBucket> {
        this.evictLru({statRecords: this.bizStatInfo.statRecords});
        if (statTime) {
            return this.checkoutBucketForPush({statId, statTime});
        }
        if (statEpoch) {
            return this.checkoutBucketForPop({statId, statEpoch});
        }
        throw new Error(`[type=${this.bizAlias()}]StatHandler, no bucket available`);
    }

    // Notice: You need announce bucket array in your derived class for individual business, and check out them in
    // method checkoutBucket(). In usual, you just need not to do anything. But you need add a new bucket and persist
    // the oldest one when a newly hour arrives.
    protected async checkoutBucketForPush({statId, statTime}): Promise<StatBucket> {
        let bucketArray = this.bizStatInfo.statRecords[statId];
        if (bucketArray === undefined) {
            bucketArray = [];
            this.bizStatInfo.statRecords[statId] = bucketArray;
        }

        let bucket = lodash.findLast(bucketArray, bucket => bucket.contains({statTime}));
        if (!bucket) {
            bucket = await this.loadBucket({statId, statTime, statEpoch: undefined});
            bucket = !bucket ? StatBucket.newInstance({statTime}) : bucket;
            bucketArray.push(bucket);
        }

        if (bucketArray.length > this.reservedBuckets()) {
            await this.awaitRollupBucket({statId, bucketArray, reservedBuckets: this.reservedBuckets()});
        }

        return Promise.resolve(bucket);
    }

    protected async checkoutBucketForPop({statId, statEpoch}): Promise<StatBucket> {
        const bucketArray = this.bizStatInfo.statRecords[statId];

        let bucket = lodash.findLast(bucketArray, bucket => bucket.contains({statEpoch}));
        if (!bucket) {
            bucket = await this.loadBucket({statId, statEpoch, statTime: undefined});
        }

        return Promise.resolve(bucket);
    }

    protected reservedBuckets(): number {
        return 2;
    }

    protected abstract bizAlias(): string;

    protected abstract warmUp({reservedBuckets});

    protected abstract loadBucket({statId, statTime, statEpoch}): Promise<StatBucket>;

    protected abstract rollupBucket({statId, bucketArray, reservedBuckets});

    protected abstract collect();

    protected async awaitRollupBucket({statId, bucketArray, reservedBuckets}) {
        await this.waitLock();
        await this.rollupBucket({statId, bucketArray, reservedBuckets}).finally(() => {
            this.dbLocked = false;
        });
    }

    protected async awaitCollect() {
        await this.waitLock();
        await this.collect().finally(() => {
            this.dbLocked = false;
        });
    }

    protected getStatRange({statEnd, statDays}): { rangeBegin: Date, rangeEnd: Date } {
        const rangeBegin = new Date(statEnd);
        rangeBegin.setDate(statEnd.getDate() - statDays);
        const rangeEnd = new Date(statEnd);
        rangeEnd.setDate(statEnd.getDate() - (statDays - 1));
        const statRange = {rangeBegin, rangeEnd};
        console.log(`[type=${this.bizAlias()}]getStatRange statRange:${JSON.stringify(statRange)}`);
        return statRange;
    }

    protected async clear({model, statEnd, statDays}) {
        const statBegin = new Date(statEnd);
        statBegin.setDate(statEnd.getDate() - statDays);
        let delRows = 0;
        do{
            delRows = await model.destroy({
                where: {statTime: {[Op.lt]: statBegin}},
                limit: 10000,
            });
        } while (delRows > 0);
    }

    public async scheduleCache(delay = 1000 * 60 * 3) {
        const that = this
        async function repeat() {
            await that.cache().catch(err => {
                console.log(`[type=${that.bizAlias()}]stream_stat_cache fail: `, err);
            });
            setTimeout(repeat, delay);
        }
        repeat().then();
        console.log(`[type=${this.bizAlias()}]schedule stream_stat_cache service in 1s interval`);
    }

    public getStat() {
        return this.cacheStatInfo;
    }

    protected abstract cache();

    protected async getStatSpan(list: any[]) {
        const minEpochNumber = list.map(item => item.minEpoch).sort()[0] || -1;
        const maxEpochNumber = list.map(item => item.maxEpoch).sort().reverse()[0] || -1;
        const minEpoch = await Epoch.findOne({where: {epoch: minEpochNumber}});
        const maxEpoch = await Epoch.findOne({where: {epoch: maxEpochNumber}});
        const minTime = minEpoch?.timestamp || null;
        const maxTime = maxEpoch?.timestamp || null;
        const statSpan = {minEpochNumber, maxEpochNumber, minTime, maxTime};
        console.log(`[type=${this.bizAlias()}]getStatSpan statSpan:${JSON.stringify(statSpan)}`);
        return statSpan;
    }

    protected async convertToAddress(list: any[]) {
        if(!list?.length) {
            return list;
        }

        const hex40IdSet = new Set<number>();
        list.forEach(item => hex40IdSet.add(item.bizId));
        const idToHex40Map = await idHex40Map(Array.from(hex40IdSet));
        list.forEach(item => {
            item['address'] = format.address(`0x${idToHex40Map.get(item.bizId)}`, StatApp.networkId);
            delete item['bizId'];
        });

        return list;
    }

    protected async waitLock() {
        while (this.dbLocked) {
            await sleep(100)
        }
        this.dbLocked = true;
    }

    protected evictLru({statRecords, maxCache = 100}){
        const len = Object.keys(statRecords).length;
        if(len <= maxCache) return statRecords;

        let statInfoArray = Object.keys(statRecords).map(bizId => {
            const bucketArray = statRecords[bizId];
            const maxEpochNumber = bucketArray[bucketArray.length-1]['maxEpochNumber'];
            return {bizId, maxEpochNumber}
        });
        statInfoArray = lodash.orderBy(statInfoArray, ['maxEpochNumber']);

        const rmArray = statInfoArray.slice(0, statInfoArray.length - maxCache);
        rmArray.forEach(item => {
            delete statRecords[item.bizId];
        });
        // console.log(`[type=${this.bizAlias()}]evictLru form:${len},to:${Object.keys(statRecords).length}`);

        return statRecords;
    }
}
