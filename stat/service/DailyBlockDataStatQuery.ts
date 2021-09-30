import {QueryTypes, Op, fn, col} from "sequelize";
import {FullBlock, FullTransaction} from "../model/FullBlock";
import {fmtDtUTC} from "../model/Utils";
import {DailyBlockDataStat} from "../model/DailyBlockDataStat";
import { getTimeByInterval } from "./tool/DateTool";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class DailyBlockDataStatQuery {
    private intervalMinInSec: number = 60;
    public INTERVAL_TYPE = {min: 'min', hour: 'hour', day: 'day'};
    protected app;

    constructor(backendApp: any) {
        this.app = backendApp;
    }

    async listMiningStat({intervalType = 'hour', skip = 0, limit = 27, sort='asc', minTimestamp = undefined
                             , maxTimestamp = undefined}) {
        let timeCol = 'statTime'
        if (intervalType === this.INTERVAL_TYPE.min) {
            timeCol = 'createdAt'
            if (maxTimestamp === undefined) {
                maxTimestamp = Math.round(Date.now() / 1000)
            }
            if (minTimestamp === undefined) {
                minTimestamp = maxTimestamp - 60 * limit
            }
            if (maxTimestamp - minTimestamp > 3600) {
                throw new Error(`Time scope exceeds 60 minutes under minute interval.`)
            }
        }
        //
        const where = {  }
        const range = []
        if (minTimestamp !== undefined) {
            range.push({[timeCol]: {[Op.gte]: new Date(minTimestamp*1000)}})
        }
        if (maxTimestamp !== undefined) {
            range.push({[timeCol]: {[Op.lte]: new Date(maxTimestamp*1000)}})
        }
        if (range.length) {
            where[Op.and] = range
        }
        if(intervalType === this.INTERVAL_TYPE.hour ||
            intervalType === this.INTERVAL_TYPE.day) {
            console.log(` fetch from db `)
            const type = intervalType === this.INTERVAL_TYPE.hour ? '1h' : '1d';
            where['statType'] = type
            const page = await DailyBlockDataStat.findAndCountAll({
                attributes: {exclude: ['tps'], include: ['statTime','blockTime',['hashrate','hashRate'], 'difficulty']},
                where, offset: skip, limit, order: [['statTime', sort]], raw: true
            })
            return {total: page.count, list: page.rows, intervalType}
        }
        // calculate real time within minutes.
        console.log(` real time calculate `)
        const list:any[] = await FullBlock.findAll({
            attributes: [
                    [fn('count', col('*')), 'blockCount'],
                    [fn('sum', col('difficulty')), 'difficultySum'],
                    [fn('DATE_FORMAT', col('createdAt'), '%Y-%m-%d %H:%i:00'), 'statTime'],
            ],
            where, raw: true,
            group: 'statTime', order: [[col('statTime'), sort]],
            logging: console.log,
        })
        const interval = this.intervalMinInSec;
        list.forEach(row=>{
            const {blockCount, difficultySum} = row
            row['blockTime'] = BigFixed(interval).div(BigFixed(blockCount));
            row['hashRate'] = BigFixed(difficultySum).div(BigFixed(interval));
            row['difficulty'] = BigFixed(difficultySum).div(BigFixed(blockCount));
        })
        return {total: list.length, list, intervalType}
    }

    async listStat(intervalType, skip: number = 0, limit: number = 27) {
        if(intervalType === this.INTERVAL_TYPE.hour ||
            intervalType === this.INTERVAL_TYPE.day){
            const type = intervalType === this.INTERVAL_TYPE.hour ? '1h' : '1d';
            const sql = `SELECT statTime, blockTime, tps, hashrate as hashRate, difficulty FROM daily_block_data_stat 
                        WHERE statType = '${type}' ORDER BY statTime DESC LIMIT ?, ?`
            const statList = await DailyBlockDataStat.sequelize.query(sql, {type: QueryTypes.SELECT,
                replacements: [skip, limit]/*, logging: console.info*/ });
            let list = statList.map(item => {
                item['timestamp'] = String((item['statTime']).getTime() / 1000);
                return item;
            });
            list = lodash.orderBy(list, 'timestamp', 'asc');
            const total = await DailyBlockDataStat.count({where: {statType: type}});
            return {total, list};
        }

        const maxBlock = await FullBlock.findOne({order:[['epoch','desc']]})
        maxBlock.createdAt.setSeconds(0);
        const beginTime = getTimeByInterval(maxBlock.createdAt, -limit + 1);
        const sqlBlock = `SELECT COUNT(*) AS blockCount, SUM( difficulty ) AS difficultySum, 
                        DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:00') AS statTime
                    FROM full_block WHERE createdAt > ? GROUP BY statTime ORDER BY statTime ASC`;
        const blockStatList = await FullBlock.sequelize.query(sqlBlock, {type: QueryTypes.SELECT,
            replacements: [fmtDtUTC(beginTime)]/*, logging: console.info*/ });
        if(!blockStatList?.length){
            return {total: 0, list: []};
        }

        const sqlTx = `SELECT COUNT(*) AS txCount, DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:00') AS statTime
                    FROM full_tx WHERE createdAt > ? GROUP BY statTime ORDER BY statTime ASC`;
        const txStatList = await FullTransaction.sequelize.query(sqlTx, {type: QueryTypes.SELECT,
            replacements: [fmtDtUTC(beginTime)]/*, logging: console.info*/ });
        const txStatMap = this.convertTxStatMap(txStatList);

        const statArray = [];
        const interval = this.intervalMinInSec;
        for(const blockStat of blockStatList) {
            if(blockStat !== undefined){
                const statTime = blockStat['statTime'];
                const blockCount = blockStat['blockCount'];
                const txCount = txStatMap[statTime] || 0;
                const difficultySum = blockStat['difficultySum'];
                const blockTime = BigFixed(interval).div(BigFixed(blockCount));
                const hashRate = BigFixed(difficultySum).div(BigFixed(interval));
                const difficulty = BigFixed(difficultySum).div(BigFixed(blockCount));
                const tps = BigFixed(txCount).div(BigFixed(interval));
                const date = new Date(statTime);
                statArray.push({statTime: date, blockTime, hashRate, difficulty, tps,
                    timestamp: String(date.getTime() / 1000) });
            }
        }
        const list = lodash.orderBy(statArray, 'timestamp', 'asc');
        return {total: limit - 1, list};
    }

    public convertTxStatMap(partialList){
        const partialMap = {};
        partialList?.forEach(row => {
            partialMap[(row['statTime'])] = row['txCount']
        });
        return partialMap;
    }
}
