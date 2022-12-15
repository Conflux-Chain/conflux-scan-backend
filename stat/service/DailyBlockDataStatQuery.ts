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

    // open-api
    async listMiningStat({intervalType = 'hour', skip = 0, limit = 10, sort='asc', minTimestamp = undefined
                             , maxTimestamp = undefined}) {
        const attributeArray = ['statTime','blockTime',['hashrate','hashRate'], 'difficulty'];
        const page = await this.listStatByAttributeArray(attributeArray, intervalType, minTimestamp, maxTimestamp,
            sort, skip, limit);
        return {total: page.count, list: page.rows, intervalType};
    }

    async listTpsStat({intervalType = 'hour', skip = 0, limit = 10, sort='desc',
                      minTimestamp = undefined, maxTimestamp = undefined}) {
        const attributeArray = ['statTime', 'tps'];
        const page = await this.listStatByAttributeArray(attributeArray, intervalType, minTimestamp, maxTimestamp,
            sort, skip, limit);
        return {total: page.count, list: page.rows, intervalType};
    }

    private async listStatByAttributeArray(attributeArray: any[], intervalType: string, minTimestamp: number,
                                           maxTimestamp: number, sort: string, skip: number, limit: number) {
        let statType;
        switch (intervalType) {
            case this.INTERVAL_TYPE.day:
                statType = '1d';
                break;
            case this.INTERVAL_TYPE.hour:
                statType = '1h';
                break;
            case this.INTERVAL_TYPE.min:
                statType = '1m';
                break;
            default:
                throw new Error(`intervalType:${intervalType} not supported`);
        }

        const queryOptions: any = {
            attributes: attributeArray,
            offset: skip,
            limit,
            order: [['statTime', sort]],
            raw: true
        };

        const conditionArray = [];
        conditionArray.push({statType});
        if (minTimestamp !== undefined) {
            conditionArray.push({statTime: {[Op.gte]: new Date(minTimestamp * 1000)}});
        }
        if (maxTimestamp !== undefined) {
            conditionArray.push({statTime: {[Op.lte]: new Date(maxTimestamp * 1000)}});
        }
        if (conditionArray.length === 1) {
            queryOptions.where = conditionArray[0];
        }
        if (conditionArray.length > 1) {
            queryOptions.where = {[Op.and]: conditionArray};
        }

        const count = this.calCount(minTimestamp, maxTimestamp, intervalType);
        const rows = await DailyBlockDataStat.findAll(queryOptions);
        rows.forEach(row => {
            // @ts-ignore
            row['statTime'] = row['statTime'].toISOString().replace('T', ' ').substr(0, 19);
        });
        return {count, rows};
    }

    // scan-api
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

    private convertTxStatMap(partialList){
        const partialMap = {};
        partialList?.forEach(row => {
            partialMap[(row['statTime'])] = row['txCount']
        });
        return partialMap;
    }

    private calCount(minTimestamp, maxTimestamp, intervalType) {
        const start = minTimestamp !== undefined ? minTimestamp : (new Date('2020-10-28 16:00:00')).getTime();
        const end = maxTimestamp !== undefined ? maxTimestamp : Date.now();
        const elapsed = end - start;

        let count;
        switch (intervalType) {
            case this.INTERVAL_TYPE.day:
                count = elapsed / (1000 * 60 * 60 * 24);
                break;
            case this.INTERVAL_TYPE.hour:
                count = elapsed / (1000 * 60 * 60);
                break;
            case this.INTERVAL_TYPE.min:
                count = elapsed / (1000 * 60);
                break;
            default:
                throw new Error(`intervalType:${intervalType} not supported`);
        }

        return Math.ceil(count);
    }
}
