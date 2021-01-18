import {Sequelize, QueryTypes, Op} from "sequelize";
import {Hex64Map, makeId} from "../model/HexMap";
import {Block} from "../model/Block";
import {IMinerBlock, MinerBlock} from "../model/MinerBlock";
import {KEY_MINER_EPOCH, KV} from "../model/KV";
import {addUTCMinutes, calculateBeginTime, fmtDtUTC} from "../model/Utils";
import {Conflux, ConfluxOption} from "js-conflux-sdk";
import { getSumFunction } from "./DBProvider";

const BigFixed = require('bigfixed');

export class DataBlockService {
    static cacheSavedTxLength = 100;
    savedTx = []
    // public currentEpoch: number;
    private sequelize: Sequelize;
    public cfx: Conflux;

    constructor(sequelize: Sequelize, cfx:ConfluxOption) {
        this.sequelize = sequelize;
        this.cfx = new Conflux(cfx)
    }

    public async schedule(rpc) {
        const that = this;
        async function repeat() {
            await that.syncBlockByEpoch(rpc)
            setTimeout(repeat, 30)
        }
        repeat().then()
    }

    public async checkPosition() {
        let pos = await KV.getNumber(KEY_MINER_EPOCH);
        if (pos !== null && !isNaN(pos)) {
            console.log(`${fmtDtUTC(new Date())} previous epoch at ${pos}`);
            return;
        }
        let remote = await this.cfx.getEpochNumber();
        const number = remote - 1000
        await KV.create({key: KEY_MINER_EPOCH, value: number.toString()})
        console.log(`${fmtDtUTC(new Date())} init position at ${number}, remote epoch is ${number}`)
    }

    public calculateTimeRange(list:IMinerBlock[]) {
        return {beginTime: list.map(blk=>blk.beginTime).sort()[0],
            endTime: list.map(blk=>blk.endTime).sort().reverse()[0]}
    }

    public calculateHashRate(list: IMinerBlock[], beginTime: string|Date, endTime: string|Date) {
        if (beginTime === undefined || endTime === undefined) {
            console.log(`time is empty`, beginTime, endTime)
            return 0
        }
        const seconds = (new Date(endTime).getTime() - new Date(beginTime).getTime()) / 1000
        let rank = 1;
        list.forEach(blk=>{
            blk.hashRate = BigFixed(blk.difficultySum).div(seconds).toString()
            blk.rank = rank ++;
        })
        return seconds
    }

    async topByType(n: number, type: string, limit: number): Promise<IMinerBlock[]>{
        console.log(`top by type : ${n} ${type} limit ${limit}`)
        if (n <= 0) {
            return Promise.reject(`invalid span ${n}`)
        }
        const maxBlock = await Block.findMax()
        if (maxBlock == null) {
            return Promise.reject(`service unavailable.`)
        }
        let timeWindow:string = '1h';
        const endDt = maxBlock.createAt;
        let beginDt: Date;
        try {
            beginDt = await calculateBeginTime(n, type, endDt);
        } catch (err) {
            return Promise.reject(`${err}`)
        }
        return this.topByTime(beginDt, endDt, timeWindow, limit)
    }

    async topByTime(beginDt: Date, endDt: Date, timeWindow: string, limit: number): Promise<IMinerBlock[]> {
        const sumFn = getSumFunction();
        const list:IMinerBlock[] = await this.sequelize.query(
    `select minerId, hex as miner, sum(blockCount) as blockCount, 
            sum(difficultySum) as difficultySum, 
            ${sumFn}(totalReward) as totalReward, 
            sum(txFee) as txFee, 
            min(beginTime) as beginTime, max(endTime) as endTime
    from minerBlock join hex40 on minerBlock.minerId =
    hex40.id where minerBlock.beginTime >= ? and minerBlock.endTime <= ? and timeWindow = ?
    group by minerId order by blockCount desc limit ${limit}`,{
            replacements: [fmtDtUTC(beginDt), fmtDtUTC(endDt), timeWindow, limit],
            type: QueryTypes.SELECT,
                benchmark: true, logging: console.log
        })
        return Promise.resolve(list)
    }

    skip1hTimes = 0
    async rollupStatPerHour(timePoint: Date = undefined) {
        if (this.skip1hTimes > 0) {
            this.skip1hTimes -= 1
            return;
        }
        // reduce minerBlock table.
        if (timePoint === undefined) {
            const max1h = await MinerBlock.findOne({
                where: {timeWindow: '1h'},
                order:[["id","DESC"]], limit: 1})
            //
            if (max1h == null) {
                const minMiner1m = await MinerBlock.findOne({
                    where: {timeWindow: '1m'},
                    order: [["id", "ASC"]], limit: 1
                })
                if (minMiner1m === null) {
                    console.log('miner table is empty, maybe.')
                    return;
                }
                timePoint = minMiner1m.beginTime
                console.log(`rollup hourly, use min block time `, minMiner1m.id, minMiner1m.beginTime)
            } else {
                // max 1h exists
                timePoint = max1h.endTime;
                console.log(`use max 1h end time ${max1h.endTime.toISOString()}`)
                // force to next hour
                timePoint.setMinutes(timePoint.getMinutes() + 59)
            }
        }
        timePoint.setMinutes(0,0,0);
        const beginDt = timePoint;
        const endDt = new Date(beginDt.getTime())
        endDt.setMinutes(59,59,999)

        const maxMiner1m = await MinerBlock.findOne({
            where: {timeWindow: '1m'},
            order: [["id", "DESC"]], limit: 1
        })
        if (maxMiner1m.beginTime.getTime() < endDt.getTime()) {
            console.log(`max 1m time ${maxMiner1m.beginTime.toISOString()} < ${
                endDt.toISOString()
            }`)
            this.skip1hTimes = 30
            return;
        }

        // this.fixUTC(endDt, beginDt, -8)
        const exists = await MinerBlock.findOne(
            {where: {beginTime: beginDt, timeWindow: '1h'}, limit: 1});
        if (exists != null) {
            console.warn(`already exists ${JSON.stringify(exists)}`)
            return;
        }
        let tbName:any = MinerBlock.getTableName();
        tbName = tbName.tableName || tbName;
        const sumFn = getSumFunction();
        // noinspection SqlResolve
        const minerBlocks:IMinerBlock[] = await this.sequelize
            .query(`SELECT minerId, sum(difficultySum) as difficultySum, sum(blockCount) as blockCount,
                        ${sumFn}(totalReward) as totalReward, 
                        sum(txFee) as txFee
                        FROM \`${tbName}\` where beginTime between ? and ? and timeWindow = '1m'
                        group by minerId`,
                { type: QueryTypes.SELECT, replacements: [fmtDtUTC(beginDt), fmtDtUTC(endDt)] ,
                    // logging: console.info
                });
        if (minerBlocks.length === 0) {
            console.info(`rollup hourly, no stats between ${beginDt.toISOString()} - ${endDt.toISOString()}`)
            return;
        }
        // this.fixUTC(endDt, beginDt, +8)
        minerBlocks.forEach(r=>{
            r.id = null
            r.beginTime = beginDt
            r.endTime = endDt
            r.timeWindow = '1h'
        })
        return MinerBlock.bulkCreate(minerBlocks,{
            // logging: console.log
        }).then(()=>{
            console.log(`rollup hourly insert count ${minerBlocks.length}`)
            setTimeout(DataBlockService.checkDBSize, 10)
        }).catch(err=>{
            console.error(`rollup by hour fail : ${err}`)
        })
    }

    static async checkDBSize() {
        const table = Block
        let maxSize = 10_0000;
        await DataBlockService.checkTableSize(table, maxSize, {})
        await DataBlockService.checkTableSize(MinerBlock, 10_0000, {timeWindow: '1m'})
        await DataBlockService.checkTableSize(Hex64Map, 10_0000, {})
    }

    static async checkTableSize(table: any, maxSize: number, where){
        const count = await table.count({})
        const deleteCount = count - maxSize
        if (count > maxSize) {
            const separator = await table.findOne({where, offset: deleteCount, limit: 1, order: [["id", "ASC"]]})
            const deleted = await table.destroy({where:{...where, id: {[Op.lt]: separator.id}}})
            // noinspection SqlResolve
            console.log(`Deleted from ${table.getTableName()}, at size ${count}, deleted ${deleted}`)
        } else {
            console.log(`table size is ok, ${table.getTableName()} ${count} < ${maxSize}`)
        }
    }

    skip1mTimes = 0
    async rollup() {
        const n = 1 // 1 minute
        if (this.skip1mTimes > 0) {
            this.skip1mTimes -= 1
            return;
        }
        // merge by time span, Block table.
        //
        const latest1m = await MinerBlock.findOne({where:{
            timeWindow: '1m',
            }, limit: 1, order: [["id", "desc"]]});
        let maxTime: Date;
        let minTime: Date;
        const maxBlock = await Block.findMax();
        if (maxBlock == null) {
            console.warn(`no block in DB`)
            return;
        }
        if (latest1m == null) {
            // merge by latest block
            // previous minute
            let dt = maxBlock.createAt;
            dt.setSeconds(59, 999)
            dt.setUTCMinutes(dt.getUTCMinutes()-n)
            maxTime = dt;
            minTime = new Date(dt.getTime())
            minTime.setSeconds(0, 0)
        } else {
            minTime = addUTCMinutes(latest1m.beginTime, n);
            maxTime = addUTCMinutes(latest1m.endTime,   n);
        }
        if (maxBlock.createAt.getTime() < maxTime.getTime()) {
            console.info(`rollup ${n} minute(s), block not ready, max is ${
                maxBlock.createAt.toISOString()}, want ${maxTime.toISOString()}`)
            this.skip1mTimes = 30;
            return;
        }
        const sumFn = getSumFunction();
        let tbName:any = Block.getTableName();
        tbName = tbName.tableName || tbName;
        // noinspection SqlResolve
        const minerBlocks = await this.sequelize
            .query(`SELECT minerId, sum(difficulty) as difficultySum, 
                        ${sumFn}(totalReward) as totalReward, 
                        sum(txFee) as txFee,
                        count(*) as blockCount
                        FROM \`${tbName}\` where createAt between ? and ?
                        group by minerId`,
            { type: QueryTypes.SELECT, replacements: [fmtDtUTC(minTime), fmtDtUTC(maxTime)],
                // logging: console.log
            });
        if (minerBlocks.length === 0) {
            console.warn(`rollup minutes, zero blocks, time between ${minTime.toISOString()
            } - ${maxTime.toISOString()}`)
            await MinerBlock.create(this.createMinerBlockTuple({}, minTime, maxTime,`${n}m`))
            return;
        }
        const beans:IMinerBlock[] = minerBlocks.map(b=>this.createMinerBlockTuple(b, minTime, maxTime, `${n}m`))
        await MinerBlock.bulkCreate(beans, {})
            .then(()=>console.log(`rollup ${n}minutes, insert count ${beans.length}`))
            .catch(err=>{
            console.info(`miner block, rollup ${n}, bulk create fail : ${err}`)
        })
        await this.rollupStatPerHour();
        return 0;
    }

    createMinerBlockTuple(obj:any, beginTime, endTime, timeWindow):IMinerBlock {
        return {
            id: null,
            ...obj,
            beginTime,
            endTime,
            timeWindow
        }
    }

    public async syncBlockByEpoch(epoch: number = undefined) {
        let minEpochNumber = 0;
        const preEpoch = await KV.getNumber(KEY_MINER_EPOCH)
        if (preEpoch == null || isNaN(preEpoch)) {
            console.log('epoch not configured.')
        } else {
            minEpochNumber = preEpoch + 1;
        }
        // console.log(`=====`, minEpochNumber, epoch)
        let hashes: string[];
        try {
            hashes = await this.cfx.getBlocksByEpochNumber(minEpochNumber);
        } catch (e) {
            console.log(`fetch blocks by epoch number fail, epoch ${minEpochNumber}.`, e)
            return;
        }
        let blockList: any[] = await Promise.all(
            hashes.map(hash=>{
                return this.cfx.getBlockByHash(hash, true)
            })
        )
        let rewardList: any[] = await this.cfx.getBlockRewardInfo(minEpochNumber);
        blockList = blockList.filter(block=>{
            const ret = this.savedTx.indexOf(block.hash) < 0
            if(!ret)console.debug(`hit cache ${block.hash}`)
            return ret;
        })
        if (blockList.length === 0) {
            return {
                code: 0, message: "ok", blockCount: 0, minEpoch: epoch
            }
        }
        // blockList = blockList.reverse(); // turn to asc order.
        let ok = true;
        let message = "ok";
        await this.sequelize.transaction(async (dbTx) => {
            let maxEpoch = 0
            await Promise.all(
                blockList.map(async (block) => {
                    maxEpoch = Math.max(maxEpoch, block.epochNumber)
                    const reward = rewardList.find(r=>r.blockHash === block.hash)
                    const addrBean = await makeId(block.miner, dbTx)
                    // const hashBean = await makeId(block.hash, dbTx)
                    // console.info(`debug timestamp ${new Date(block.timestamp)}`)
                    return await Block.findOrCreate({
                        where: {hash: block.hash},
                        defaults: {
                            epoch: block.epochNumber,
                            createAt: new Date(block.timestamp*1000),
                            minerId: addrBean.id,
                            hash: block.hash,
                            difficulty: block.difficulty,
                            totalReward: reward.totalReward,
                            txFee: reward.txFee,
                        },
                        transaction: dbTx
                    })
                })
            )
            const updateConfig = await KV.update({value: minEpochNumber.toString()},
                {where: {key: KEY_MINER_EPOCH,}, transaction: dbTx})
            if (updateConfig[0] === 0) {
                await KV.create({key: KEY_MINER_EPOCH, value: maxEpoch.toString()}
                ,{transaction: dbTx})
            }
        }).then(async ()=>{
            // console.log(`====`, blockList[0])
            console.info(`${fmtDtUTC(new Date())} insert block count ${blockList.length}, at epoch ${
                blockList[0].epochNumber
            }, max block time ${new Date(blockList[blockList.length-1].timestamp*1000).toISOString()}`)
            // adjust cache size.
            blockList.forEach(block=>{this.savedTx.push(block.hash)})
            while (this.savedTx.length > DataBlockService.cacheSavedTxLength) {
                this.savedTx.shift()
            }
            await this.rollup()
        }).catch(err => {
            ok = false;
            message = `${err}`
            console.error(`sync blocks fail, min epoch ${epoch}`, err)
        });
        return {
            code: ok ? 0 : 500, message, blockCount: blockList.length
        };
    }
}