import {FullBlock, FullTransaction} from "../model/FullBlock";
import {QueryTypes} from "sequelize";
import {fmtDtUTC} from "../model/Utils";
import {DailyBlockDataStat} from "../model/DailyBlockDataStat";
import {getTimeByInterval} from "./tool/DateTool";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class DailyBlockDataStatQuery {

    private intervalMinInSec: number = 60;
    public INTERVAL_TYPE = {min: 'min', hour: 'hour', day: 'day'};

    async listStat(intervalType, skip: number = 0, limit: number = 27) {
        if(intervalType === this.INTERVAL_TYPE.hour ||
            intervalType === this.INTERVAL_TYPE.day){
            const type = intervalType === this.INTERVAL_TYPE.hour ? '1h' : '1d';
            const sql = `SELECT statTime, blockTime, tps, hashrate, difficulty FROM daily_block_data_stat 
                        WHERE statType = '${type}' ORDER BY statTime DESC LIMIT ?, ?`
            const statList = await DailyBlockDataStat.sequelize.query(sql, {type: QueryTypes.SELECT,
                replacements: [skip, limit]/*, logging: console.info*/ });
            let list = statList.map(item => {
                item['timestamp'] = (item['statTime']).getTime() / 1000
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
            return [];
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
                    timestamp: date.getTime() / 1000 });
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
