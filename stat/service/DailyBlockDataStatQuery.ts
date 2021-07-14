// @ts-ignore
import {format} from "js-conflux-sdk";
import {DailyContractStat} from "../model/DailyContractStat";
import {Hex40Map} from "../model/HexMap";
import {FullBlock, FullTransaction} from "../model/FullBlock";
import {QueryTypes} from "sequelize";
import {fmtDtUTC} from "../model/Utils";
import {DailyBlockDataStat} from "../model/DailyBlockDataStat";

const BigFixed = require('bigfixed');
const lodash = require('lodash');
const moment = require('moment');

export class DailyBlockDataStatQuery {

    private intervalMinInSec: number = 60;
    private intervalHourInSec: number = 3600;
    public static INTERVAL_TYPE = {min: 'min', hour: 'hour', day: 'day'};

    async listStat(intervalType, skip: number = 0, limit: number = 27) {
        let beginTime;
        let sqlBlock;
        let sqlTx;
        let inverval;
        if(intervalType === DailyBlockDataStatQuery.INTERVAL_TYPE.min){
            beginTime = undefined;
            sqlBlock = `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:00') AS time, SUM( difficulty ) AS difficultySum, 
                        COUNT(*) AS blockCntr FROM full_block WHERE createdAt > ? GROUP BY time ORDER BY time ASC`;
            sqlTx = `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:00') AS time, COUNT(*) AS txCntr
                        FROM full_tx WHERE createdAt > ? GROUP BY time ORDER BY time ASC`;
            inverval = this.intervalMinInSec;
        }
        if(intervalType === DailyBlockDataStatQuery.INTERVAL_TYPE.hour){
            beginTime = undefined;
            sqlBlock = `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d %H:00:00') AS time, SUM( difficulty ) AS difficultySum, 
                        COUNT(*) AS blockCntr FROM full_block WHERE createdAt >= ? GROUP BY time ORDER BY time ASC`;
            sqlTx = `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d %H:00:00') AS time, COUNT(*) AS txCntr
                        FROM full_tx WHERE createdAt > ? GROUP BY time ORDER BY time ASC`;
            inverval = this.intervalHourInSec;
        }
        if(intervalType === DailyBlockDataStatQuery.INTERVAL_TYPE.day){
            const sql = `SELECT statTime, blockTime, tps, hashrate, difficulty FROM daily_block_data_stat 
                        WHERE statType = '1d' ORDER BY statTime DESC LIMIT ？, ？`
            const statList = await DailyBlockDataStat.sequelize.query(sql, {type: QueryTypes.SELECT,
                replacements: [skip, limit]/*, logging: console.info*/ });
            return statList;
        }

        const blockStatList = await FullBlock.sequelize.query(sqlBlock, {type: QueryTypes.SELECT,
            replacements: [fmtDtUTC(beginTime)]/*, logging: console.info*/ });
        if(!blockStatList?.length){
            return [];
        }
        const txStatList = await FullTransaction.sequelize.query(sqlTx, {type: QueryTypes.SELECT,
            replacements: [fmtDtUTC(beginTime)]/*, logging: console.info*/ });
        const txStatMap = this.convertTxStatMap(txStatList);

        const statArray = [];
        for(const blockStat of blockStatList) {
            if(blockStat !== undefined){
                const statUTCTime = blockStat['statTime'];
                const blockCount = blockStat['blockCount'];
                const txCount = txStatMap[statUTCTime] || 0;
                const difficultySum = blockStat['difficultySum'];
                const blockTime = BigFixed(inverval).div(BigFixed(blockCount));
                const hashRate = BigFixed(difficultySum).div(BigFixed(inverval));
                const difficulty = BigFixed(difficultySum).div(BigFixed(blockCount));
                const tps = BigFixed(txCount).div(BigFixed(inverval));
                statArray.push({timestamp: (new Date(statUTCTime)).getTime(), blockTime, hashRate, difficulty, tps});
            }
        }
        return statArray;
    }

    public convertTxStatMap(partialList){
        const partialMap = {};
        partialList?.forEach(row => {
            partialMap[(row['statTime'])] = row['txCount']
        });
        return partialMap;
    }
}
