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
    private intervalHourInSec = BigFixed(3600);
    private intervalDayInSec = BigFixed(86400);

    constructor() {
        this.sequelize = DailyBlockDataStat.sequelize;
    }

    public async statByHour(): Promise<any>{
        // get time span
        const maxStat = await DailyBlockDataStat.findOne({where:{statType:'1h'}, order:[['statTime','desc']]});
        let maxStatTime = maxStat?.statTime;
        if(maxStatTime === undefined){
            maxStatTime = new Date(' 2020-10-28 16:00:00');
            await this.initFirstStat(maxStatTime);
        }
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
        const difficultySum = BigFixed(blockStat[0]['difficultySum'] || 0);
        const blockCount = BigFixed(blockStat[0]['blockCount']);
        const txCount = BigFixed(txStat[0]['txCount']);
        const difficulty = blockCount.isZero() ? BigFixed(0) : difficultySum.div(blockCount);
        const blockTime = blockCount.isZero() ? BigFixed(0) : this.intervalHourInSec.div(blockCount);
        const hashRate = difficultySum.div(this.intervalHourInSec);
        const tps = txCount.div(this.intervalHourInSec);
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
            let blockCountPerDay = BigFixed(0);
            let txCountPerDay = BigFixed(0);
            let difficultyPerDay = BigFixed(0);
            lodash.forEach(statList, stat => {
                blockCountPerDay = blockCountPerDay.add(BigFixed(stat['blockCount']));
                txCountPerDay = txCountPerDay.add(BigFixed(stat['txCount']));
                difficultyPerDay = difficultyPerDay.add(BigFixed(stat['difficultySum']));
            });

            // build daily record
            let difficulty = BigFixed(0);
            let hashRate = BigFixed(0);
            const blockTime = blockCountPerDay.isZero() ? BigFixed(0) : this.intervalDayInSec.div(blockCountPerDay);
            const tps = txCountPerDay.div(this.intervalDayInSec);
            const statTime = beginTimeInDay;
            lodash.forEach(statList, stat => {
                difficulty = blockCountPerDay.isZero() ? BigFixed(0)
                    : difficulty.add(BigFixed(stat['difficultySum']).div(blockCountPerDay));
                hashRate = hashRate.add(BigFixed(stat['difficultySum']).div(this.intervalDayInSec));
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
        let blockCountPerDay = BigFixed(0);
        let txCountPerDay = BigFixed(0);
        let difficultyPerDay = BigFixed(0);
        for(const blockStat of blockStatList) {
                if(blockStat !== undefined){
                    const statTime = blockStat['statTime'];
                    const blockCount = BigFixed(blockStat['blockCount']);
                    const txCount = BigFixed(txStatMap[statTime] || 0);
                    const difficultySum = BigFixed(blockStat['difficultySum'] || 0);
                    const blockTime = blockCount.isZero() ? BigFixed(0) : this.intervalHourInSec.div(blockCount);
                    const hashRate = difficultySum.div(this.intervalHourInSec);
                    const difficulty = blockCount.isZero() ? BigFixed(0) : difficultySum.div(blockCount);
                    const tps = txCount.div(this.intervalHourInSec);
                    partialStatArray.push({statTime, statType: '1h', blockCount, txCount, difficultySum,
                        blockTime, hashRate, difficulty, tps});
                    blockCountPerDay = blockCountPerDay.add(blockCount);
                    txCountPerDay = txCountPerDay.add(txCount);
                    difficultyPerDay = difficultyPerDay.add(difficultySum);
                }
        }
        const statArray = this.convertTotalStatArray(beginTime, partialStatArray);

        // data per day
        let hashRateInDay = BigFixed(0);
        let difficultyInDay = BigFixed(0);
        lodash.forEach(blockStatList, blockStat => {
            hashRateInDay = hashRateInDay.add(BigFixed(blockStat['difficultySum'] || 0).div(this.intervalDayInSec));
            difficultyInDay = blockCountPerDay.isZero() ? BigFixed(0)
                : difficultyInDay.add(BigFixed(blockStat['difficultySum'] || 0).div(blockCountPerDay));
        });
        const statInDay = {
            statTime: beginTime,
            statType: '1d',
            blockCount: blockCountPerDay,
            txCount: txCountPerDay,
            difficultySum:  difficultyPerDay,
            blockTime: blockCountPerDay.isZero() ? BigFixed(0) : this.intervalDayInSec.div(blockCountPerDay),
            hashRate: hashRateInDay,
            difficulty: difficultyInDay,
            tps: txCountPerDay.div(this.intervalDayInSec),
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
            if(stat){
                stat.statTime = statTime;
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

    private async initFirstStat(firstStatTime){
        const firstStat = lodash.defaults({},
            {statTime: firstStatTime,
            statType: '1h',
            blockCount: 0,
            txCount: 0,
            difficultySum:  0,
            blockTime:0,
            hashRate: 0,
            difficulty: 0,
            tps: 0});
        await DailyBlockDataStat.add(firstStat);
    }
}
