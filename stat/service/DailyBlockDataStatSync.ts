import {calBeginEndTime, getTimeByInterval, getYesterday} from "./tool/DateTool";
import {Sequelize, QueryTypes} from 'sequelize'
import {FullBlock, FullTransaction} from "../model/FullBlock";
import {DailyBlockDataStat} from "../model/DailyBlockDataStat";
import {fmtDtUTC} from "../model/Utils";

const BigFixed = require('bigfixed');
const lodash = require('lodash');
const moment = require('moment');

export class DailyBlockDataStatSync{
    private sequelize: Sequelize;
    private intervalHourInSec: number = 3600;
    private intervalDayInSec: number = 86400;

    constructor(sequelize: Sequelize) {
        this.sequelize = sequelize;
    }

    public async statByHour(): Promise<any>{
        // get time span
        const maxStat = await DailyBlockDataStat.findOne({where:{statType:'1h'}, order:[['statTime','desc']]});
        const maxStatTime = maxStat.statTime;
        const nextBeginTime = getTimeByInterval(maxStatTime, 60);
        const nextEndTime = getTimeByInterval(maxStatTime, 60 * 2);
        const nextSafeTime = getTimeByInterval(maxStatTime, 60 * 2 + 3);
        const now = new Date();
        if( nextSafeTime > now ){
            return Promise.resolve(false);
        }

        // stat hourly
        const blockSql = `SELECT SUM(difficulty) AS difficultySum, COUNT(*) AS blockCount FROM full_block 
                WHERE createdAt >= ? and createdAt < ?`;
        const blockStat = await FullBlock.sequelize.query(blockSql, {type: QueryTypes.SELECT,
            replacements: [fmtDtUTC(nextBeginTime), fmtDtUTC(nextEndTime)], raw: true/*, logging: console.info*/ });
        const txSql = `SELECT COUNT(*) AS txCount FROM full_tx WHERE createdAt >= ? and createdAt < ?`;
        const txStat = await FullTransaction.sequelize.query(txSql, {type: QueryTypes.SELECT,
            replacements: [fmtDtUTC(nextBeginTime), fmtDtUTC(nextEndTime)], raw: true/*, logging: console.info*/ });
        const statTime = nextBeginTime;
        const difficultySum = blockStat[0]['difficultySum'];
        const blockCount = blockStat[0]['blockCount'];
        const txCount = txStat[0]['txCount'] || 0;
        const difficulty = BigFixed(difficultySum).div(BigFixed(blockCount));
        const blockTime = BigFixed(this.intervalHourInSec).div(BigFixed(blockCount));
        const hashRate = BigFixed(difficultySum).div(BigFixed(this.intervalHourInSec));
        const tps = BigFixed(txCount).div(BigFixed(this.intervalHourInSec));
        const statArray = [{statTime, statType: '1h', difficultySum, blockCount, txCount,
            difficulty, blockTime, hashRate, tps}];

        // stat daily
        const nextHour = moment(nextBeginTime).format('HH');
        if(nextHour === '23'){
            const {beginTime: beginTimeInDay, endTime: endTimeInDay} =  calBeginEndTime(nextBeginTime);
            const statSql = `SELECT statTime,statType,blockCount,txCount,difficultySum FROM daily_block_data_stat 
                    WHERE statTime >= ? and statTime < ? and statType = '1h'` ;
            const statList = await DailyBlockDataStat.sequelize.query(statSql, {type: QueryTypes.SELECT,
                replacements: [fmtDtUTC(beginTimeInDay), fmtDtUTC(endTimeInDay)], raw: true/*, logging: console.info*/ });
            statList.push(statArray[0]);
            let blockCountPerDay = 0;
            let txCountPerDay = 0;
            let difficultyPerDay = 0;
            lodash.forEach(statList, stat => {
                blockCountPerDay = blockCountPerDay +stat['blockCount'];
                txCountPerDay = txCountPerDay + stat['txCount'];
                difficultyPerDay = BigFixed(difficultyPerDay).add(BigFixed(stat['difficultySum']));
            });

            // build daily record
            let difficulty = 0;
            let hashRate = 0;
            const blockTime = BigFixed(this.intervalDayInSec).div(BigFixed(blockCountPerDay));
            const tps = BigFixed(txCountPerDay).div(BigFixed(this.intervalDayInSec));
            const statTime = beginTimeInDay;
            lodash.forEach(statList, stat => {
                difficulty = BigFixed(difficulty).add(BigFixed(stat['difficultySum']).div(BigFixed(blockCountPerDay)));
                hashRate =  BigFixed(hashRate).add(BigFixed(stat['difficultySum']).div(BigFixed(this.intervalDayInSec)));
            });
            const statInDay = {statTime, statType: '1d', difficultySum:  difficultyPerDay, blockCount: blockCountPerDay,
                txCount: txCountPerDay, difficulty, hashRate, blockTime, tps};
            statArray.push(statInDay);
        }
        await DailyBlockDataStat.bulkCreate(statArray);
        console.log(`block_data_stat by hour, statTime:${nextBeginTime},statArray${JSON.stringify(statArray)}`);
        return Promise.resolve(true);
    }

    public async statDaily(statDay: Date): Promise<any>{
        // query data
        const {beginTime, endTime} = calBeginEndTime(statDay);
        const sqlBlock = `SELECT DATE_FORMAT(createdAt,'%Y-%m-%d %H:00:00') AS statTime,
                       SUM(difficulty) AS difficultySum, COUNT(*) AS blockCount
                     FROM full_block
                     WHERE createdAt >= ? and createdAt < ?
                     GROUP BY statTime`;
        const blockStatList = await FullBlock.sequelize.query(sqlBlock, {type: QueryTypes.SELECT,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)]/*, logging: console.info*/ });
        if(!blockStatList?.length){
            return [];
        }
        const sqlTx = `SELECT DATE_FORMAT(createdAt,'%Y-%m-%d %H:00:00') AS statTime,
                        COUNT(*) AS txCount
                      FROM full_tx
                      WHERE createdAt >= ? and createdAt < ?
                      GROUP BY statTime`;
        const txStatList = await FullTransaction.sequelize.query(sqlTx, {type: QueryTypes.SELECT,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)]/*, logging: console.info*/ });
        const txStatMap = this.convertTxStatMap(txStatList);

        // data per hour
        const partialStatArray = [];
        let blockCountPerDay = 0;
        let txCountPerDay = 0;
        let difficultyPerDay = 0;
        for(const blockStat of blockStatList) {
                if(blockStat !== undefined){
                    const statTime = blockStat['statTime'];
                    const blockCount = blockStat['blockCount'];
                    const txCount = txStatMap[statTime] || 0;
                    const difficultySum = blockStat['difficultySum'];
                    const blockTime = BigFixed(this.intervalHourInSec).div(BigFixed(blockCount));
                    const hashRate = BigFixed(difficultySum).div(BigFixed(this.intervalHourInSec));
                    const difficulty = BigFixed(difficultySum).div(BigFixed(blockCount));
                    const tps = BigFixed(txCount).div(BigFixed(this.intervalHourInSec));
                    partialStatArray.push({statTime, statType: '1h', blockCount, txCount, difficultySum,
                        blockTime, hashRate, difficulty, tps});
                    blockCountPerDay = blockCountPerDay +blockCount;
                    txCountPerDay = txCountPerDay + txCount;
                    difficultyPerDay = BigFixed(difficultyPerDay).add(BigFixed(difficultySum));
                }
        }
        const statArray = this.convertTotalStatArray(beginTime, partialStatArray);

        // data per day
        let hashRateInDay = 0;
        let difficultyInDay = 0;
        lodash.forEach(blockStatList, blockStat => {
            hashRateInDay = BigFixed(hashRateInDay).add(BigFixed(blockStat['difficultySum'])
                .div(BigFixed(this.intervalDayInSec)));
            difficultyInDay = BigFixed(difficultyInDay).add(BigFixed(blockStat['difficultySum'])
                .div(BigFixed(blockCountPerDay)));
        });
        const statInDay = {
            statTime: beginTime,
            statType: '1d',
            blockCount: blockCountPerDay,
            txCount: txCountPerDay,
            difficultySum:  difficultyPerDay,
            blockTime: BigFixed(this.intervalDayInSec).div(BigFixed(blockCountPerDay)),
            hashRate: hashRateInDay,
            difficulty: difficultyInDay,
            tps: BigFixed(txCountPerDay).div(BigFixed(this.intervalDayInSec)),
        };
        statArray.push(statInDay);

        // persistent
        const record = await DailyBlockDataStat.findOne({where: {statTime: beginTime,  statType: '1d'}})
        if(record) {
            return Promise.resolve(statArray);
        }
        await DailyBlockDataStat.bulkCreate(statArray);
        console.log(`block_data_stat daily, statTime:${beginTime},statArray${JSON.stringify(statArray)}`);
        return Promise.resolve(statArray);
    }

    public async statHistory(startDay?: Date, endDay?: Date){
        const start = startDay || new Date('2020/10/29');
        const end = endDay || getYesterday(new Date());
        do{
            console.log(`block_data_stat history at day:${fmtDtUTC(start)} start...`);
            await this.statDaily(start);
            console.log(`block_data_stat history at day:${fmtDtUTC(start)} end.`);
            start.setDate(start.getDate() + 1)
        } while(start.getTime() <= end.getTime());
    }

    // 16:10:00 UTC
    public async schedule() {
        const that = this;
        async function repeat() {
            await that.statByHour().catch(err => {console.log(` block_data_stat by hour fail: `, err);});
            setTimeout(repeat, 1000 * 10);
        }
        repeat().then();
    }

    public convertTxStatMap(partialList){
        const partialMap = {};
        partialList?.forEach(row => {
            partialMap[(row['statTime'])] = row['txCount']
        });
        return partialMap;
    }

    public convertTotalStatArray(statDate, statArray){
        const statMap = {};
        statArray.forEach(stat => {
            statMap[stat.statTime] = stat;
        });

        const totalStatArray = [];
        lodash.range(24).forEach(i => {
            const base = new Date(statDate);
            const statTime = new Date(base.setHours(base.getHours() + i));
            const stat = statMap[fmtDtUTC(statTime).substr(0,19)];
            stat.statTime = statTime;
            if(stat){
                totalStatArray.push(stat);
            } else{
                totalStatArray.push({
                    statTime, statType: '1h', blockCount: 0, txCount: 0, difficultySum: 0,
                    blockTime: 0, hashRate: 0, difficulty: 0, tps: 0
                });
            }
        });
        return totalStatArray;
    }
}
