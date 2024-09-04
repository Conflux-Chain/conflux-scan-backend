import {col, Sequelize, QueryTypes, Op, fn} from "sequelize";
import {IMinerBlock, MinerBlock} from "../model/MinerBlock";
import {adjustTodayEndTime, calculateBeginTime, fmtDtUTC, getEpochRange, sqlLogFn} from "../model/Utils";
// @ts-ignore
import {Conflux, ConfluxOption, format} from "js-conflux-sdk";
import {getDBConf, getSumFunction} from "./DBProvider";
import {StatApp} from "../StatApp";
import {batchFetchBlock} from "./common/utils";
import {sleep} from "./tool/ProcessTool";
import {Epoch} from "../model/Epoch";
import {FullBlock} from "../model/FullBlock";
import {init} from "./tool/FixDailyTokenStat";
import {TxnQuery} from "./TxnQuery";

const BigFixed = require('bigfixed');
let _showLog = false
let STAT_SPAN_MINUTES = 10
export class BlockAndMinerSync {
    static CODE_REWARD_NOT_READY = 125;
    static cacheSavedTxLength = 100;
    // public currentEpoch: number;

    constructor() {
    }

    public async schedule() {
        const delay:number = 60_000 * STAT_SPAN_MINUTES;
        const that = this;
        async function repeat() {
            await that.rollupStatPerHour().catch(e=>{
                console.log(`${__filename} rollupStatPerHour error `, e)
            })
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
    // refreshed in TxnSync.scheduleCache()
    static rankCache = new Map<string, Object>()
    static async topByType(n: number, type: string, limit: number = 10, useCache = true): Promise<{list:IMinerBlock[], allDifficulty:number}>{
        // console.log(`miner top by type : ${n} ${type} limit ${limit}`)
        if (n <= 0) {
            return Promise.reject(`invalid span ${n}`)
        }
        const cacheKey = `${n}${type}${limit}`
        const cacheV = useCache ? BlockAndMinerSync.rankCache.get(cacheKey) : undefined;
        if (cacheV !== undefined) {
            // console.log(`hit cache `, cacheKey)
            return cacheV as any;
        }
        const maxBlock = await MinerBlock.findOne({order: [['beginTime','desc']]})
        if (maxBlock == null) {
            return {list: [], allDifficulty: 0}
        }
        let timeWindow:string = '1h';
        const endDt = maxBlock.endTime;
        let beginDt: Date;
        try {
            beginDt = await calculateBeginTime(n, type, endDt);
        } catch (err) {
            return Promise.reject(`${err}`)
        }
        adjustTodayEndTime(endDt, !useCache)
        const v = BlockAndMinerSync.topByTime(beginDt, endDt, timeWindow, limit);
        BlockAndMinerSync.rankCache.set(cacheKey, v)
        console.log(`${__filename} ${cacheKey}`)
        return v
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
                logging: _showLog ? console.log : false,
        })
        list.forEach(item=>{
            // @ts-ignore
            item['base32'] = format.address(`0x${item.miner}`, StatApp.networkId)
        })
        const allDifficulty = await MinerBlock.sum("difficultySum", {
            where: {beginTime: {[Op.gte]:beginDt}, endTime:{[Op.lte]:endDt}, timeWindow: timeWindow},
            // benchmark: true, logging: console.log
        })
        return Promise.resolve({allDifficulty,list,
            updatedAt: new Date().toISOString(),
            sqlBeginTime: beginDt.toISOString(),
            sqlEndTime: endDt.toISOString(),
        })
    }

    /**
     * rollup per hour, calculate current hour and previous hour blocks(in case pivot switched).
     */
    async rollupStatPerHour(showLog=false) {
        const now = new Date()
        showLog && console.log(`rollupStatPerHour by date `, now.toISOString())
        await this.rollupByHour(now, showLog)
        // previous hour.
        if (now.getMinutes() < STAT_SPAN_MINUTES * 1.5) {
            now.setHours(now.getHours() - 1)
        }
        await this.rollupByHour(now, showLog)
    }
    async rollupByHour(timePoint:Date, showLog = false) {
        timePoint.setMinutes(0,0,0);
        const beginDt = timePoint;
        // find the epoch with time >= time point
        const endDt = new Date(beginDt.getTime())
        endDt.setMinutes(59,59,999)
        adjustTodayEndTime(endDt, showLog)
        // find the epoch with time <= endDt
        const [startEpoch, endEpoch] = await getEpochRange(beginDt, endDt);
        if (showLog) {
            console.log(` time range ${beginDt.toISOString()}  ${endDt.toISOString()}`)
            console.log(` epoch range ${startEpoch}  ${endEpoch}`)
        }
        const statByMinerIdList = (await FullBlock.findAll({
            where: {
                epoch:{[Op.between]:[startEpoch, endEpoch]},
                // totalReward:{[Op.gt]: 0} // it depends on filling reward progress, unstable
            },
            attributes: [
                'minerId',
                [fn('sum', col('difficulty')), 'difficultySum'],
                [fn('count', col('*')), 'blockCount'],
                [fn('sum', col('totalReward')), 'totalReward'],
                [fn('sum', col('txFee')), 'txFee'],
            ],
            group: ['minerId'], raw: true,
            logging: showLog ? console.log : false,
        })) as any[];
        if (statByMinerIdList.length === 0) {
            console.info(`rollup hourly, no stats between ${beginDt.toISOString()} - ${endDt.toISOString()
            }, that is, epoch between ${startEpoch}, ${endEpoch}`)
            return;
        }
        statByMinerIdList.forEach(r=>{
            r.id = null
            r.beginTime = beginDt
            r.endTime = endDt
            r.timeWindow = '1h'
        })
        return MinerBlock.bulkCreate(statByMinerIdList,{
            updateOnDuplicate: ['difficultySum','blockCount','totalReward', 'txFee'],
            // logging: showLog ? console.log : false // should not log insert sql, it's massive.
        }).then(()=>{
            console.log(`miner block stat, rollup hourly epoch ${startEpoch} insert count ${statByMinerIdList.length}`)
        }).catch(err=>{
            console.error(`rollup by hour fail : ${err}`)
        })
    }
}

export async function countRecentMiner(days: number, showLog=false) {
    const {beginTime, endTime} = TxnQuery.buildTimeRange(days);
    return MinerBlock.count({
        where: { beginTime: {[Op.between]: [beginTime, endTime]}, timeWindow:'1h'},
        distinct: true, col: 'minerId',
        // benchmark: true,
        logging: showLog ? sqlLogFn('count recent miner') : false
    })
}

async function main() {
    _showLog = true
    await init();
    const [,,dtStr] = process.argv
    const svc = new BlockAndMinerSync()

    if (dtStr === "top") {
        const {list} = await BlockAndMinerSync.topByType(24, 'h', 10, false)
        list.forEach(row=>{
            console.log(`${row["base32"]} block ${row.blockCount} `)
        })
    } else {
        const now = Date.now()
        const dt = new Date(dtStr)

        StatApp.networkId = 1

        while (dt.getTime() < now) {
            console.log()
            await svc.rollupByHour(dt, true)
            dt.setHours(dt.getHours() + 1)
        }
    }

    console.log(`done`)
    MinerBlock.sequelize.close().then()
}

if (module === require.main) {
    main().then()
}
// node stat/service/BlockAndMinerSync.js 2024-05-21
