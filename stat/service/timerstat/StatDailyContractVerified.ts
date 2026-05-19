import {Op, QueryTypes} from 'sequelize'
import {DailyContractVerified} from "../../model/DailyContractStat";
import {Epoch} from "../../model/Epoch";
import {fmtDtUTC} from "../../model/Utils";
import {StatType, TimerStat} from "./TimerStat";
import {VerifiedContracts} from "../../model/VerifiedContracts";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class StatDailyContractVerified extends TimerStat{

    constructor(app: any, interval: number = 1000 * 60) {
        super(app);
        this.baseInterval = StatType.TEN_MIN;
        this.schedule(interval).then();
    }

    public bizAlias(): string {
        return `${DailyContractVerified.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyContractVerified.findOne({
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
        await DailyContractVerified.sequelize.transaction(async (dbTx) => {
            await DailyContractVerified.destroy({
                where: {statType: dStat.statType, statDay: dStat.statDay}, transaction: dbTx,
            });
            await DailyContractVerified.bulkCreate(statArray, {
                transaction: dbTx,
            });
        });
    }

    // ------------------------------- biz -----------------------------------
    public async statRaw(beginTime: Date, endTime: Date): Promise<DailyContractVerified> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval);

        const dailyCount = await VerifiedContracts.count({
            where: {
                [Op.and]:[
                    {verifiedAt: {
                            [Op.gte]:beginTime.getTime() / 1000
                        }},
                    {verifiedAt: {
                            [Op.lt]:endTime.getTime() / 1000
                        }}
                ]
            },
        });
        const total = await VerifiedContracts.count({
            where: {verifiedAt: {[Op.lt]: endTime.getTime() / 1000}},
        });

        return {
            statDay: beginTime, statType: intervalType, verifiedNew: dailyCount, verifiedTotal: total
        } as DailyContractVerified;
    }

    public async statAnalysis(endTime: Date, srcStatType: StatType, destStatType: StatType,
                              latestStat = undefined): Promise<DailyContractVerified> {
        const beginTime = this.getRangeBegin(endTime, destStatType);

        const statSql = `SELECT statDay,statType,verifiedNew,verifiedTotal FROM daily_contract_verified 
                    WHERE statType = '${srcStatType}' and statDay >= ? and statDay < ?` ;
        const statList = await DailyContractVerified.sequelize.query(statSql, { type: QueryTypes.SELECT, raw: true,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
        });
        if(latestStat) {
            statList.push(latestStat);
        }

        const statDay = beginTime;
        let verifiedNew = BigFixed(0);
        lodash.forEach(statList, stat => {
            verifiedNew = verifiedNew.add(BigFixed(stat['verifiedNew']));
        });
        const verifiedTotal = BigFixed(statList[statList.length - 1]['verifiedTotal']);

        return {statDay, statType: destStatType,
            verifiedNew, verifiedTotal
        } as DailyContractVerified;
    }
}