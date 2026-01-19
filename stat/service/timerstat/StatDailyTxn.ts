import {col, fn, literal, Op, QueryTypes} from 'sequelize'
import {DailyTransaction} from "../../model/DailyTransaction";
import {FullTransaction} from "../../model/FullBlock";
import {fmtDtUTC} from "../../model/Utils";
import {StatType, TimerStat} from "./TimerStat";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class StatDailyTxn extends TimerStat{

    constructor(app: any, interval: number = 1000 * 60) {
        super(app);
        this.baseInterval = StatType.TEN_MIN;
        this.schedule(interval).then();
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
        // TxnQuery.gasUsedSum  ref to this parameter, statType = '10m' .
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
        const dStat = await this.statAnalysis(rangeEnd, StatType.TEN_MIN, StatType.DAY, mStat);

        const statArray = [mStat, dStat];
        await DailyTransaction.sequelize.transaction(async (dbTx) => {
            await DailyTransaction.destroy({
                where: {statType: dStat.statType, statDay: dStat.statDay}, transaction: dbTx,
            });
            await DailyTransaction.bulkCreate(statArray, {
                transaction: dbTx,
            });
        });
    }

    // ------------------------------- biz -----------------------------------
    public async statRaw(beginTime: Date, endTime: Date): Promise<DailyTransaction> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval);

        const stat: any = await FullTransaction.findOne({
            attributes:[
                [literal(`count(distinct fromId)`), 'senderCount'],
                [fn('count',col('*')), 'txCount'],
                [fn('sum',col('gas')), 'gasFee'],
            ],
            where: {
                [Op.and]:[
                    {createdAt: {[Op.gte]: beginTime}},
                    {createdAt: {[Op.lt]: endTime}},
                    // {status: 0}, // 2024.8.27  , remove this filter as discussed in TG group.
                ]
            },
            raw: true,
        });

        const {senderCount, txCount, gasFee} = stat;
        return {
            statDay: beginTime, statType: intervalType,
            senderCount, txCount, gasFee: gasFee || 0
        } as DailyTransaction;
    }

    public async statAnalysis(endTime: Date, srcStatType: StatType, destStatType: StatType,
                              latestStat = undefined): Promise<DailyTransaction> {
        const beginTime = this.getRangeBegin(endTime, destStatType);

        const statSql = `SELECT statDay,statType,senderCount,txCount,gasFee FROM tx_daily 
                    WHERE statType = '${srcStatType}' and statDay >= ? and statDay < ?` ;
        const statList = await DailyTransaction.sequelize.query(statSql, { type: QueryTypes.SELECT, raw: true,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
        });
        if(latestStat) {
            statList.push(latestStat);
        }

        const statDay = beginTime;
        let senderCount = BigFixed(0);
        let txCount = BigFixed(0);
        let gasFee = BigFixed(0);
        lodash.forEach(statList, stat => {
            senderCount = senderCount.add(BigFixed(stat['senderCount']));
            txCount = txCount.add(BigFixed(stat['txCount']));
            gasFee = gasFee.add(BigFixed(stat['gasFee'] || 0));
        });

        return {statDay, statType: destStatType,
            senderCount, txCount, gasFee
        } as DailyTransaction;
    }
}
