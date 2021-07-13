import {calBeginEndTime, getNextDelay, getYesterday} from "./tool/DateTool";
import {Sequelize, QueryTypes} from 'sequelize'
import {FullBlock, FullTransaction} from "../model/FullBlock";
import {DailyBlockDataStat} from "../model/DailyBlockDataStat";
import {fmtDtUTC} from "../model/Utils";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class DailyBlockDataStatSync{
    private sequelize: Sequelize;
    private intervalHourInSec: number = 3600;
    private intervalDayInSec: number = 86400;

    constructor(sequelize: Sequelize) {
        this.sequelize = sequelize;
    }

    public async statDaily(statDay: Date): Promise<any>{
        const {beginTime, endTime} = calBeginEndTime(statDay);
        console.log(`typeof beginTime----------------------------${fmtDtUTC(beginTime)}`)
        console.log(`typeof endTime----------------------------${typeof endTime}`)
        const sqlBlock = `SELECT DATE_FORMAT(createdAt,'%Y-%m-%d %H:00:00') AS statTime, 
                       SUM(difficulty) AS difficultySum, COUNT(*) AS blockCount 
                     FROM full_block 
                     WHERE createdAt >= ? and createdAt < ?
                     GROUP BY statTime`;
        const blockStatList = await FullBlock.sequelize.query(sqlBlock, {type: QueryTypes.SELECT,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)], logging: console.info });// time, difficultySum, blockCount
        if(!blockStatList?.length){
            return [];
        }
        console.log(`blockStatList----------------------------${JSON.stringify(blockStatList)}`)
        const sqlTx = `SELECT DATE_FORMAT(createdAt,'%Y-%m-%d %H:00:00') AS statTime, 
                        COUNT(*) AS txCount 
                      FROM full_tx 
                      WHERE createdAt >= ? and createdAt < ?
                      GROUP BY statTime`;
        const txStatList = await FullTransaction.sequelize.query(sqlTx, {type: QueryTypes.SELECT,
            replacements: [beginTime, endTime], logging: console.info });// time, difficultySum, blockCount
        console.log(`txStatList----------------------------${JSON.stringify(txStatList)}`)
        const txStatMap = this.convertTxStatMap(txStatList);
        console.log(`txStatMap----------------------------${JSON.stringify(txStatMap)}`)

        const statArray = [];
        let blockCountPerDay = 0;
        let txCountPerDay = 0;
        let difficultyPerDay = 0;
        for(const blockStat of blockStatList) {
                if(blockStat !== undefined){
                    const statTime = blockStat['statTime'];
                    const blockCount = blockStat['blockCount'];
                    const txCount = txStatMap[statTime] || 0;
                    const difficultySum = blockStat['difficultySum'];
                    console.log(`typeof blockCount----------------------------${typeof blockCount}`)
                    console.log(`typeof difficultySum----------------------------${typeof difficultySum}`)
                    const blockTime = BigFixed(this.intervalHourInSec).div(BigFixed(blockCount));
                    const hashRate = BigFixed(difficultySum).div(BigFixed(this.intervalHourInSec));
                    const difficulty = BigFixed(difficultySum).div(BigFixed(blockCount));
                    const tps = BigFixed(txCount).div(BigFixed(this.intervalHourInSec));
                    statArray.push({statTime, statType: '1h', blockCount, txCount, difficultySum,
                        blockTime, hashRate, difficulty, tps});
                    blockCountPerDay = blockCountPerDay +blockCount;
                    txCountPerDay = txCountPerDay + txCount;
                    difficultyPerDay = BigFixed(difficultyPerDay).add(BigFixed(difficultySum));
                }
            }
        console.log(`statArrayPerHour----------------------------${JSON.stringify(statArray)}`)

        let hashRateInDay = 0;
        let difficultyInDay = 0;
        lodash.forEach(blockStatList, blockStat => {
            hashRateInDay =  BigFixed(hashRateInDay).add(BigFixed(blockStat['difficultySum'])
                .div(BigFixed(this.intervalDayInSec)));
            difficultyInDay = BigFixed(difficultyInDay).add(BigFixed(blockStat['difficultySum'])
                .div(BigFixed(blockCountPerDay)));
        });
        const statInDay = {
            statTime: fmtDtUTC(beginTime).slice(0, -11),
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
        console.log(`statArrayPerDay----------------------------${JSON.stringify(statArray)}`)

        await DailyBlockDataStat.bulkCreate(statArray);
        return Promise.resolve(statArray);
    }

    public async statHistory(startDay?: Date, endDay?: Date){
        const start = startDay || new Date('2020/10/29');
        const end = endDay || getYesterday(new Date());
        do{
            console.log(`block data stat history at day:${start} start...`);
            await this.statDaily(start);
            console.log(`block data stat history at day:${start} end.`);
            start.setDate(start.getDate() + 1)
        } while(start.getTime() <= end.getTime());
    }

    // 16:10:00 UTC
    public async schedule() {
        const that = this;
        async function repeat() {
            const now = new Date();
            await that.statDaily(getYesterday(now)).catch(err=>{
                console.log(`daily_block_data_stat fail: `, err);
            });
            const delay = getNextDelay(now, 1, 10);
            console.log(`schedule daily_block_data_stat service in delay ${delay/1000}s.`);
            setTimeout(repeat, delay);
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
}
