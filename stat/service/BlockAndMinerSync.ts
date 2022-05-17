import {col, Sequelize, QueryTypes, Op, fn} from "sequelize";
import {IMinerBlock, MinerBlock} from "../model/MinerBlock";
import {calculateBeginTime, fmtDtUTC} from "../model/Utils";
// @ts-ignore
import {Conflux, ConfluxOption, format} from "js-conflux-sdk";
import {getDBConf, getSumFunction} from "./DBProvider";
import {StatApp} from "../StatApp";
import {batchFetchBlock} from "./common/utils";
import {sleep} from "./tool/ProcessTool";
import {Epoch} from "../model/Epoch";
import {FullBlock} from "../model/FullBlock";

const BigFixed = require('bigfixed');

export class BlockAndMinerSync {
    static CODE_REWARD_NOT_READY = 125;
    static cacheSavedTxLength = 100;
    // public currentEpoch: number;

    constructor() {
    }

    public async schedule(delay:number = 3600_000) {
        const that = this;
        async function repeat() {
            await that.rollupStatPerHour()
            setTimeout(repeat, delay);
        }
        repeat().then()
    }

    static calculateTimeRange(list:IMinerBlock[]) {
        return {beginTime: list.map(blk=>blk.beginTime).sort()[0],
            endTime: list.map(blk=>blk.endTime).sort().reverse()[0]}
    }

    static calculateHashRate(list: IMinerBlock[], beginTime: string|Date, endTime: string|Date) {
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

    static async topByType(n: number, type: string, limit: number = 10): Promise<{list:IMinerBlock[], allDifficulty:number}>{
        console.log(`top by type : ${n} ${type} limit ${limit}`)
        if (n <= 0) {
            return Promise.reject(`invalid span ${n}`)
        }
        const maxBlock = await MinerBlock.findMax()
        if (maxBlock == null) {
            return Promise.reject(`service unavailable, table is empty.`)
        }
        let timeWindow:string = '1h';
        const endDt = maxBlock.endTime;
        let beginDt: Date;
        try {
            beginDt = await calculateBeginTime(n, type, endDt);
        } catch (err) {
            return Promise.reject(`${err}`)
        }
        return BlockAndMinerSync.topByTime(beginDt, endDt, timeWindow, limit)
    }

    static async topByTime(beginDt: Date, endDt: Date, timeWindow: string, limit: number): Promise<{list:IMinerBlock[], allDifficulty:number}> {
        const sumFn = getSumFunction();
        const list:IMinerBlock[] = await MinerBlock.sequelize.query(
    `select minerId, hex as miner, sum(blockCount) as blockCount, 
            sum(difficultySum) as difficultySum, 
            ${sumFn}(totalReward) as totalReward, 
            sum(txFee) as txFee, 
            min(beginTime) as beginTime, max(endTime) as endTime
    from minerBlock join hex40 on minerBlock.minerId =
    hex40.id where minerBlock.beginTime >= ? and minerBlock.endTime <= ? and timeWindow = ?
    group by minerId order by blockCount desc limit ${limit}`,{
            replacements: [beginDt, endDt, timeWindow, limit],
            type: QueryTypes.SELECT,
                // benchmark: true,
                // logging: console.log
        })
        list.forEach(item=>{
            // @ts-ignore
            item['base32'] = format.address(`0x${item.miner}`, StatApp.networkId)
        })
        const allDifficulty = await MinerBlock.sum("difficultySum", {
            where: {beginTime: {[Op.gte]:beginDt}, endTime:{[Op.lte]:endDt}, timeWindow: timeWindow},
            // benchmark: true, logging: console.log
        })
        return Promise.resolve({allDifficulty,list})
    }

    /**
     * rollup per hour, calculate current hour and previous hour blocks(in case pivot switched).
     */
    async rollupStatPerHour() {
        const now = new Date()
        await this.rollupByHour(now)
        // previous hour.
        now.setHours(now.getHours() - 1)
        await this.rollupByHour(now)
    }
    async rollupByHour(timePoint:Date) {
        timePoint.setMinutes(0,0,0);
        const beginDt = timePoint;
        // find the epoch with time >= time point
        const endDt = new Date(beginDt.getTime())
        endDt.setMinutes(59,59,999)
        // find the epoch with time <= endDt
        const [startEpoch, endEpoch] = await Promise.all([
            Epoch.findOne({where: {timestamp:{[Op.gte]:beginDt}}, order:[['timestamp','asc']],
                // logging: console.log,
            }),
            Epoch.findOne({where: {timestamp:{[Op.lte]:endDt}}, order:[['timestamp','desc']],
                // logging: console.log,
            })
        ])
        if (startEpoch === null || endEpoch === null) {
            console.log(` start epoch or end epoch is missing, ${startEpoch?.epoch}, ${endEpoch?.epoch
            }, ${beginDt.toISOString()} ${endDt.toISOString()}`)
            return;
        }

        const statByMinerIdList = (await FullBlock.findAll({
            where: {epoch:{[Op.between]:[startEpoch.epoch, endEpoch.epoch]}, totalReward:{[Op.gt]: 0}},
            attributes: [
                'minerId',
                [fn('sum', col('difficulty')), 'difficultySum'],
                [fn('count', col('*')), 'blockCount'],
                [fn('sum', col('totalReward')), 'totalReward'],
                [fn('sum', col('txFee')), 'txFee'],
            ],
            group: ['minerId'], raw: true,
            // logging: console.log,
        })) as any[]
        if (statByMinerIdList.length === 0) {
            console.info(`rollup hourly, no stats between ${beginDt.toISOString()} - ${endDt.toISOString()
            }, that is, epoch between ${startEpoch.epoch}, ${endEpoch.epoch}`)
            return;
        }
        statByMinerIdList.forEach(r=>{
            r.id = null
            r.beginTime = beginDt
            r.endTime = endDt
            r.timeWindow = '1h'
        })
        return MinerBlock.bulkCreate(statByMinerIdList,{
            updateOnDuplicate: ['difficultySum','blockCount','totalReward', 'txFee']
            // logging: console.log
        }).then(()=>{
            console.log(`miner block stat, rollup hourly insert count ${statByMinerIdList.length}`)
        }).catch(err=>{
            console.error(`rollup by hour fail : ${err}`)
        })
    }
}

export async function countRecentMiner(days: number) {
    return MinerBlock.count({
        where: { 'beginTime': {[Op.gt]: fn('addtime', fn('now'), `${days} 0:0:0`)}, timeWindow:'1h'},
        distinct: true, col: 'minerId'
        // benchmark: true, logging: console.log
    })
}