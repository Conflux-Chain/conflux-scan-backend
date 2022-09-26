import {col, fn, Op, QueryTypes} from 'sequelize'
import {DailyTransaction} from "../../model/DailyTransaction";
import {FullTransaction} from "../../model/FullBlock";
import {fmtDtUTC} from "../../model/Utils";
import {IntervalType, TimerStat} from "./TimerStat";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class StatDailyTxn extends TimerStat{

    constructor(app: any) {
        super(app);
        this.baseInterval = IntervalType.TEN_MIN;
    }

    public bizAlias(): string {
        return `${DailyTransaction.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyTransaction.findOne({
            where: {statType: this.baseInterval},
            order:[["statDay","desc"]],
            limit: 1
        });
        return this.getStatRangeMin(lastStat, 10);
    }

    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        return FullTransaction.findOne({
            attributes:['epoch'],
            where: {createdAt: {[Op.gte]: rangeEnd}},
            order:[['createdAt', 'asc']],
            limit: 1
        }).then(item => item?.epoch);
    }

    public async stat(rangeBegin: Date, rangeEnd: Date){
        const mStat = await this.statRaw(rangeBegin, rangeEnd);
        const dStat = await this.statAnalysis(rangeEnd, IntervalType.TEN_MIN, IntervalType.DAY, mStat);
        this.debug && console.log(`debug-5,mStat:${JSON.stringify(mStat)},dStat:${JSON.stringify(dStat)}`);

        const statArray = [mStat, dStat];
        await DailyTransaction.sequelize.transaction(async (dbTx) => {
            await DailyTransaction.destroy({
                where: {statDay: dStat.statDay, statType: dStat.statType}, transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]destroy ${msg}`),*/
            });
            await DailyTransaction.bulkCreate(statArray, {
                transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]bulkCreate ${msg}`),*/
            });
        });
        console.log(`[${this.bizAlias()}]record:${JSON.stringify(statArray)}`);
    }

    // ------------------------------- biz -----------------------------------
    public async statRaw(beginTime: Date, endTime: Date): Promise<DailyTransaction> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval);

        const stat: any = await FullTransaction.findOne({
            attributes:[
                [fn('count',col('*')), 'txCount'],
                [fn('sum',col('gas')), 'gasFee'],
            ],
            where: {
                [Op.and]:[
                    {createdAt: {[Op.gte]: beginTime}},
                    {createdAt: {[Op.lt]: endTime}},
                    {status: 0},
                ]
            },
            raw: true,
            /*logging: msg => console.log(`[${this.bizAlias()}]tx daily query ${msg}`)*/
        });

        const {txCount, gasFee} = stat;
        return {
            statDay: beginTime, statType: intervalType,
            txCount, gasFee: gasFee || 0
        } as DailyTransaction;
    }

    public async statAnalysis(endTime: Date, srcStatType: IntervalType, destStatType: IntervalType,
                              latestStat = undefined): Promise<DailyTransaction> {
        const beginTime = this.getRangeBegin(endTime, destStatType);

        const statSql = `SELECT statDay,statType,txCount,gasFee FROM tx_daily 
                    WHERE statDay >= ? and statDay < ? and statType = '${srcStatType}'` ;
        const statList = await DailyTransaction.sequelize.query(statSql, { type: QueryTypes.SELECT, raw: true,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
            /*logging: msg => console.log(`[${this.bizAlias()}]stat list query ${msg}`)*/
        });
        if(latestStat) {
            statList.push(latestStat);
        }

        const statDay = beginTime;
        let txCount = BigFixed(0);
        let gasFee = BigFixed(0);
        lodash.forEach(statList, stat => {
            txCount = txCount.add(BigFixed(stat['txCount']));
            gasFee = gasFee.add(BigFixed(stat['gasFee'] || 0));
        });

        return {statDay, statType: destStatType,
            txCount, gasFee
        } as DailyTransaction;
    }
}
