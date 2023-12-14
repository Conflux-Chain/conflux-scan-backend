import {Op, QueryTypes} from 'sequelize'
import {DailyContractCreate} from "../../model/DailyContractCreate";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {Epoch} from "../../model/Epoch";
import {fmtDtUTC} from "../../model/Utils";
import {TimerStat, IntervalType} from "./TimerStat";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class StatDailyContractCreation extends TimerStat{

    constructor(app: any) {
        super(app);
        this.baseInterval = IntervalType.TEN_MIN;
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
        const dStat = await this.statAnalysis(rangeEnd, IntervalType.TEN_MIN, IntervalType.DAY, mStat);
        this.debug && console.log(`debug-5,mStat:${JSON.stringify(mStat)},dStat:${JSON.stringify(dStat)}`);

        const statArray = [mStat, dStat];
        await DailyContractCreate.sequelize.transaction(async (dbTx) => {
            await DailyContractCreate.destroy({
                where: {statType: dStat.statType, statDay: dStat.statDay}, transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]destroy ${msg}`),*/
            });
            await DailyContractCreate.bulkCreate(statArray, {
                transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]bulkCreate ${msg}`),*/
            });
        });
        console.log(`[${this.bizAlias()}]record:${JSON.stringify(statArray)}`);
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
            /*logging: msg => console.log(`[${this.bizAlias()}]contact daily query ${msg}`)*/
        });
        const total = await TraceCreateContract.count({
            where: {blockTime: {[Op.lt]: endTime.getTime() / 1000}},
            /*logging: msg => console.log(`[${this.bizAlias()}]contract total query ${msg}`)*/
        });

        return {
            statDay: beginTime, statType: intervalType, contractCount: dailyCount, contractTotal: total
        } as DailyContractCreate;
    }

    public async statAnalysis(endTime: Date, srcStatType: IntervalType, destStatType: IntervalType,
                               latestStat = undefined): Promise<DailyContractCreate> {
        const beginTime = this.getRangeBegin(endTime, destStatType);

        const statSql = `SELECT statDay,statType,contractCount,contractTotal FROM daily_contract_create 
                    WHERE statType = '${srcStatType}' and statDay >= ? and statDay < ?` ;
        const statList = await DailyContractCreate.sequelize.query(statSql, { type: QueryTypes.SELECT, raw: true,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
            /*logging: msg => console.log(`[${this.bizAlias()}]stat list query ${msg}`)*/
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