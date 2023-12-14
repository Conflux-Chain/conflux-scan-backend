import {Op} from 'sequelize'
import {CfxBalance} from "../../model/Balance";
import {DailyCfxHolder} from "../../model/DailyCfxHolder";
import {CfxTransfer} from "../../model/CfxTransfer";
import {IntervalType, TimerStat} from "./TimerStat";

export class StatTotalCfxHolder extends TimerStat{

    constructor(app: any) {
        super(app);
        this.baseInterval = IntervalType.TEN_MIN;
    }

    public bizAlias(): string {
        return `${DailyCfxHolder.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyCfxHolder.findOne({
            where: {statType: this.baseInterval},
            order:[["statDay","desc"]],
            limit: 1
        });
        return this.getStatRangeMin(lastStat, 10);
    }

    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        return CfxTransfer.findOne({
            attributes:['epoch'],
            where: {createdAt: {[Op.gte]: rangeEnd}},
            order:[['createdAt', 'asc']],
            limit: 1
        }).then(item => item?.epoch);
    }

    public async stat(rangeBegin: Date, rangeEnd: Date) {
        const mStat = await this.statRaw(rangeBegin, rangeEnd);
        const dStat = {
            statDay: this.getRangeBegin(rangeEnd, IntervalType.DAY),
            statType: IntervalType.DAY,
            holderCount: mStat.holderCount,
        };
        this.debug && console.log(`debug-5,mStat:${JSON.stringify(mStat)},dStat:${JSON.stringify(dStat)}`);

        const statArray = [mStat, dStat];
        await DailyCfxHolder.sequelize.transaction(async (dbTx) => {
            await DailyCfxHolder.destroy({
                where: {statType: dStat.statType, statDay: dStat.statDay}, transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]destroy ${msg}`),*/
            });
            await DailyCfxHolder.bulkCreate(statArray, {
                transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]bulkCreate ${msg}`),*/
            });
        });
        console.log(`[${this.bizAlias()}]record:${JSON.stringify(statArray)}`);
    }

    // ------------------------------- biz -----------------------------------
    public async statRaw(beginTime: Date, endTime: Date): Promise<DailyCfxHolder> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval);

        const holderCount = await CfxBalance.count({
            /*logging: msg => console.log(`[${this.bizAlias()}]cfx holder query ${msg}`)*/
        });

        return {
            statDay: beginTime, statType: intervalType, holderCount
        } as DailyCfxHolder;
    }
}