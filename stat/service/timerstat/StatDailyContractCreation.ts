import {Op, QueryTypes} from 'sequelize'
import {DailyContractCreate} from "../../model/DailyContractStat";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {Epoch} from "../../model/Epoch";
import {fmtDtUTC} from "../../model/Utils";
import {StatType, TimerStat} from "./TimerStat";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class StatDailyContractCreation extends TimerStat{

    constructor(app: any) {
        super(app);
        this.baseInterval = StatType.TEN_MIN;
    }

    public bizAlias(): string {
        return `${DailyContractCreate.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyContractCreate.findOne({
            where: {statType: this.baseInterval},
            order:[["statDay","desc"]],
            limit: 1
        });
        return this.getStatRangeMin(lastStat, 10);
    }

    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        return Epoch.findOne({
            attributes:['epoch'],
            where: {timestamp: {[Op.gte]: rangeEnd}},
            order:[['timestamp', 'asc']],
            limit: 1
        }).then(item => item?.epoch);
    }

    public async stat(rangeBegin: Date, rangeEnd: Date) {
        const mStat = await this.statRaw(rangeBegin, rangeEnd);
        const dStat = await this.statAnalysis(rangeEnd, StatType.TEN_MIN, StatType.DAY, mStat);

        const statArray = [mStat, dStat];
        await DailyContractCreate.sequelize.transaction(async (dbTx) => {
            await DailyContractCreate.destroy({
                where: {statType: dStat.statType, statDay: dStat.statDay}, transaction: dbTx,
            });
            await DailyContractCreate.bulkCreate(statArray, {
                transaction: dbTx,
            });
        });
    }

    // ------------------------------- biz -----------------------------------
    public async statRaw(beginTime: Date, endTime: Date): Promise<DailyContractCreate> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval);

        const dailyCount = await TraceCreateContract.count({
            where: {
                [Op.and]:[
                    {blockTime: {
                            [Op.gte]:beginTime.getTime() / 1000
                        }},
                    {blockTime: {
                            [Op.lt]:endTime.getTime() / 1000
                        }}
                ]
            },
        });
        const total = await TraceCreateContract.count({
            where: {blockTime: {[Op.lt]: endTime.getTime() / 1000}},
        });

        return {
            statDay: beginTime, statType: intervalType, contractCount: dailyCount, contractTotal: total
        } as DailyContractCreate;
    }

    public async statAnalysis(endTime: Date, srcStatType: StatType, destStatType: StatType,
                              latestStat = undefined): Promise<DailyContractCreate> {
        const beginTime = this.getRangeBegin(endTime, destStatType);

        const statSql = `SELECT statDay,statType,contractCount,contractTotal FROM daily_contract_create 
                    WHERE statType = '${srcStatType}' and statDay >= ? and statDay < ?` ;
        const statList = await DailyContractCreate.sequelize.query(statSql, { type: QueryTypes.SELECT, raw: true,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
        });
        if(latestStat) {
            statList.push(latestStat);
        }

        const statDay = beginTime;
        let contractCount = BigFixed(0);
        lodash.forEach(statList, stat => {
            contractCount = contractCount.add(BigFixed(stat['contractCount']));
        });
        const contractTotal = BigFixed(statList[statList.length - 1]['contractTotal']);

        return {statDay, statType: destStatType,
            contractCount, contractTotal
        } as DailyContractCreate;
    }
}