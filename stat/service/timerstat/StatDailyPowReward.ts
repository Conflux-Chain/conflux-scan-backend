import {Op, QueryTypes} from 'sequelize'
import {fmtDtUTC} from "../../model/Utils";
import {StatType, TimerStat} from "./TimerStat";
import {DailyPowRewardStat} from "../../model/DailyReward";
import {Drip} from "js-conflux-sdk";
import {FullBlock} from "../../model/FullBlock";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class StatDailyPowReward extends TimerStat{

    constructor(app: any, interval: number = 1000 * 60 * 10) {
        super(app);
        this.baseInterval = StatType.HOUR;
        this.schedule(interval).then();
    }

    public bizAlias(): string {
        return `${DailyPowRewardStat.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyPowRewardStat.findOne({
            where: {statType: this.baseInterval},
            order:[["statTime","desc"]],
            limit: 1
        });
        return this.getStatRangeMin(lastStat, 60);
    }

    /*
    pow reward sum via FullBlock
    select * from full_block where createdAt >= '2022-02-27 06' and totalReward > 0 order by createdAt asc limit 1;
    */
    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        const fullBlock = await FullBlock.findOne({
            where: {createdAt: {[Op.gte]:rangeEnd }}, order: [['createdAt', 'asc']]});
        const epoch = fullBlock?.epoch;
        if(epoch === undefined) {
            return undefined;
        }

        return epoch;
    }

    public async stat(rangeBegin: Date, rangeEnd: Date){
        const hStat = await this.statRaw(rangeBegin, rangeEnd);
        const dStat = await this.statAnalysis(rangeEnd, StatType.HOUR, StatType.DAY, hStat);
        const mStat = await this.statAnalysis(rangeEnd, StatType.HOUR, StatType.MONTH, hStat);

        const statArray = [hStat, dStat, mStat];
        await DailyPowRewardStat.sequelize.transaction(async (dbTx) => {
            await DailyPowRewardStat.destroy({
                where: {statType: dStat.statType, statTime: dStat.statTime}, transaction: dbTx,
            });
            await DailyPowRewardStat.destroy({
                where: {statType: mStat.statType, statTime: mStat.statTime}, transaction: dbTx,
            });
            await DailyPowRewardStat.bulkCreate(statArray, {
                transaction: dbTx,
            });
        });
    }

    // ------------------------------- biz -----------------------------------
    private async statRaw(beginTime: Date, endTime: Date): Promise<DailyPowRewardStat> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval);

        const rewardSql = `select sum(totalReward) as powReward from ${FullBlock.getTableName()} where createdAt >= ? and createdAt < ?`;
        const rewardTotalSql = `select sum(powReward) as powRewardTotal from ${DailyPowRewardStat.getTableName()} where statType = '${intervalType}' and statTime < ?`;
        const [powRewardStat, powRewardTotalStat] = await Promise.all([
            FullBlock.sequelize.query(rewardSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
            }),
            DailyPowRewardStat.sequelize.query(rewardTotalSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime)],
            })
        ]);

        const statTime = beginTime;
        const drip = powRewardStat[0]['powReward'] || 0;
        const powReward = BigFixed(new Drip(drip).toCFX());
        const powRewardTotal = BigFixed(powRewardTotalStat[0]['powRewardTotal'] || 0).add(powReward);

        return {
            statTime, statType: intervalType,
            powReward, powRewardTotal
        } as DailyPowRewardStat;
    }

    private async statAnalysis(endTime: Date, srcStatType: StatType, destStatType: StatType,
                               latestStat = undefined): Promise<DailyPowRewardStat> {
        const beginTime = this.getRangeBegin(endTime, destStatType);

        const statSql = `select statTime,statType,powReward from ${DailyPowRewardStat.getTableName()}
                    where statType = '${srcStatType}' and statTime >= ? and statTime < ?`;
        const totalSql = `select sum(powReward) as powRewardTotal from ${DailyPowRewardStat.getTableName()} 
                    where statType = '${destStatType}' and statTime < ?`;

        const [statList, totalStat] = await Promise.all([
            DailyPowRewardStat.sequelize.query(statSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)]}),
            DailyPowRewardStat.sequelize.query(totalSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime)],
            }),
        ]);
        if(latestStat) {
            statList.push(latestStat);
        }

        const statTime = beginTime;
        let powReward = BigFixed(0);
        lodash.forEach(statList, stat => {
            powReward = powReward.add(BigFixed(stat['powReward']));
        });
        const powRewardTotal = BigFixed(totalStat[0]['powRewardTotal'] || 0).add(powReward);

        return {statTime, statType: destStatType,
            powReward, powRewardTotal
        } as DailyPowRewardStat;
    }
}
