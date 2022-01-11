import {StatApp} from "../../StatApp";
import {RedisStreamMessage, RedisWrap} from "../RedisWrap";
import {StatMessage} from "./StatMessage";
import {BizStatInfo} from "./BizStatInfo";
import {StatBucket} from "./StatBucket";
import {Epoch} from "../../model/Epoch";
const lodash = require('lodash');

export abstract class StatHandler {
    protected bizQueue: string;
    protected bizStatInfo: BizStatInfo;
    protected app: StatApp;

    protected constructor(app: StatApp) {
        this.app = app;
    }

    public async schedule(delay = 1000 * 60 * 3) {
        await this.warmUp({reservedBuckets: this.reservedBuckets()});
        await this.listen();

        const that = this

        async function repeat() {
            await that.collect().catch(err => {
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
            if(!message.epochTimestamp){
                const epochObj = await Epoch.findOne({where: {epoch: epochNumber}, raw: true})
                message.epochTimestamp = epochObj.timestamp;
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
            this.rollupBucket({statId, bucketArray: [bucket], reservedBuckets: 0});
        }
    }

    protected async revoke({epochNumber, epochTimestamp, message}): Promise<any> {
        const statInfo = message.statInfo;
        for (const statId of Object.keys(statInfo)) {
            const bucket = await this.checkoutBucket({statId, statEpoch: epochNumber});
            bucket.decrease({epochNumber, valArray: statInfo[statId]});
            this.rollupBucket({statId, bucketArray: [bucket], reservedBuckets: 0});
        }
    }

    protected async checkoutBucket({statId, statTime = undefined, statEpoch = undefined}): Promise<StatBucket> {
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
            await this.rollupBucket({statId, bucketArray, reservedBuckets: this.reservedBuckets()});
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
}
