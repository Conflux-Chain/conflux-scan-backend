import {Op, QueryTypes} from 'sequelize'
import {fmtDtUTC} from "../../model/Utils";
import {IntervalType, TimerStat} from "./TimerStat";
import {DailyPosRewardStat} from "../../model/DailyReward";
import {PosEpochRewardHash, PosReward} from "../../model/PoS";
import {Drip} from "js-conflux-sdk";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class StatDailyPosReward extends TimerStat{

    constructor(app: any) {
        super(app);
        this.baseInterval = IntervalType.HOUR;
    }

    public bizAlias(): string {
        return `${DailyPosRewardStat.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyPosRewardStat.findOne({
            where: {statType: this.baseInterval},
            order:[["statTime","desc"]],
            limit: 1
        });
        return this.getStatRangeMin(lastStat, 60, true);
    }

    /*
    pos reward sum via PosReward
    select * from pos_reward where createdAt >= '2022-02-27 06' order by createdAt asc limit 1;
    select * from pos_epoch_reward_hash where epoch >= 8 order by epoch asc limit 1;
    */
    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        const posReward = await PosReward.findOne({
            where: {createdAt: {[Op.gte]:rangeEnd }}, order: [['createdAt', 'asc']]});
        const posEpoch = posReward?.epoch;
        if(posEpoch === undefined){
            return undefined;
        }

        const powEpochRecord = await PosEpochRewardHash.findOne({
            where: {epoch: {[Op.gte]: posEpoch}}, order: [['epoch', 'asc']]});
        if(powEpochRecord === null) {
            return undefined;
        }

        return powEpochRecord.powEpoch;
    }

    public async stat(rangeBegin: Date, rangeEnd: Date){
        const hStat = await this.statRaw(rangeBegin, rangeEnd);
        const dStat = await this.statAnalysis(rangeEnd, IntervalType.HOUR, IntervalType.DAY, hStat);
        const mStat = await this.statAnalysis(rangeEnd, IntervalType.HOUR, IntervalType.MONTH, hStat);
        this.debug && console.log(`debug-5,hStat:${JSON.stringify(hStat)},dStat:${JSON.stringify(dStat)}`);

        const statArray = [hStat, dStat, mStat];
        await DailyPosRewardStat.sequelize.transaction(async (dbTx) => {
            await DailyPosRewardStat.destroy({
                where: {statType: dStat.statType, statTime: dStat.statTime}, transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]destroy ${msg}`),*/
            });
            await DailyPosRewardStat.destroy({
                where: {statType: mStat.statType, statTime: mStat.statTime}, transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]destroy ${msg}`),*/
            });
            await DailyPosRewardStat.bulkCreate(statArray, {
                transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]bulkCreate ${msg}`),*/
            });
        });
        console.log(`[${this.bizAlias()}]record:${JSON.stringify(statArray)}`);
    }

    // ------------------------------- biz -----------------------------------
    private async statRaw(beginTime: Date, endTime: Date): Promise<DailyPosRewardStat> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval);

        const rewardSql = `select sum(reward) as posReward from ${PosReward.getTableName()} where createdAt >= ? and createdAt < ?`;
        const rewardTotalSql = `select sum(posReward) as posRewardTotal from ${DailyPosRewardStat.getTableName()} where statType = '${intervalType}' and statTime < ?`;
        const [posRewardStat, posRewardTotalStat] = await Promise.all([
            PosReward.sequelize.query(rewardSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
            }),
            DailyPosRewardStat.sequelize.query(rewardTotalSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime)],
            })
        ]);

        const statTime = beginTime;
        const drip = posRewardStat[0]['posReward'] || 0;
        const posReward = BigFixed(new Drip(drip).toCFX());
        const posRewardTotal = BigFixed(posRewardTotalStat[0]['posRewardTotal'] || 0).add(posReward);

        return {
            statTime, statType: intervalType,
            posReward, posRewardTotal
        } as DailyPosRewardStat;
    }

    private async statAnalysis(endTime: Date, srcStatType: IntervalType, destStatType: IntervalType,
                                latestStat = undefined): Promise<DailyPosRewardStat> {
        const beginTime = this.getRangeBegin(endTime, destStatType);

        const statSql = `select statTime,statType,posReward from ${DailyPosRewardStat.getTableName()}
                    where statType = '${srcStatType}' and statTime >= ? and statTime < ?` ;
        const totalSql = `select sum(posReward) as posRewardTotal from ${DailyPosRewardStat.getTableName()} 
                    where statType = '${destStatType}' and statTime < ?`;

        const [statList, totalStat] = await Promise.all([
            DailyPosRewardStat.sequelize.query(statSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)]}),
            DailyPosRewardStat.sequelize.query(totalSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime)],
            }),
        ]);
        if(latestStat) {
            statList.push(latestStat);
        }

        const statTime = beginTime;
        let posReward = BigFixed(0);
        lodash.forEach(statList, stat => {
            posReward = posReward.add(BigFixed(stat['posReward']));
        });
        const posRewardTotal = BigFixed(totalStat[0]['posRewardTotal'] || 0).add(posReward);

        return {statTime, statType: destStatType,
            posReward, posRewardTotal
        } as DailyPosRewardStat;
    }
}
