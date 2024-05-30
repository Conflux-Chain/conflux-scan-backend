import {col, fn, Op} from 'sequelize'
import {IntervalType, TimerStat} from "./TimerStat";
import {DailyBurntFeeStat} from "../../model/DailyBurntFeeStat";
import {Epoch} from "../../model/Epoch";

const BigFixed = require('bigfixed');

export class StatDailyBurntFee extends TimerStat{

    constructor(app: any) {
        super(app);
        this.baseInterval = IntervalType.HOUR;
    }

    public bizAlias(): string {
        return `${DailyBurntFeeStat.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyBurntFeeStat.findOne({
            where: {statType: this.baseInterval},
            order:[["statTime","desc"]],
            limit: 1
        });
        return this.getStatRangeMin(lastStat, 60);
    }

    /*
    total storage fee: convertedStoragePoints/1024 from cfx_cfx_getCollateralInfo
    total gas fee: result from cfx_getFeeBurnt
    */
    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
            return Epoch.findOne({
                attributes:['epoch'],
                where: {timestamp: {[Op.gte]: rangeEnd}},
                order:[['timestamp', 'asc']],
                limit: 1,
            }).then(item => item?.epoch);
    }

    public async stat(rangeBegin: Date, rangeEnd: Date){
        const hStat = await this.statRaw(rangeBegin, rangeEnd);
        const dStat = await this.statAnalysis(rangeEnd, IntervalType.DAY);

        const statArray = [hStat, dStat];
        await DailyBurntFeeStat.sequelize.transaction(async (dbTx) => {
            await DailyBurntFeeStat.destroy({
                where: {statType: dStat.statType, statTime: dStat.statTime}, transaction: dbTx});
            await DailyBurntFeeStat.bulkCreate(statArray, {transaction: dbTx});
        });
        console.log(`[${this.bizAlias()}]record:${JSON.stringify(statArray)}`);
    }

    // ------------------------------- biz -----------------------------------
    private async statRaw(beginTime: Date, endTime: Date): Promise<DailyBurntFeeStat> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval)
        return this.statBurntFee(intervalType, beginTime, endTime)
    }

    private async statAnalysis(endTime: Date, destStatType: IntervalType): Promise<DailyBurntFeeStat> {
        const beginTime = this.getRangeBegin(endTime, destStatType);
        return this.statBurntFee(destStatType, beginTime, endTime)
    }

    private async statBurntFee(statType: string, beginTime: Date, endTime: Date) {
        const {
            app: { cfx }
        } = this

        const epochRange = await Epoch.findOne({
            attributes:[
                [fn('min', col('epoch')), 'minEpoch'],
                [fn('max', col('epoch')), 'maxEpoch']
            ],
            where: {[Op.and]: [
                    {timestamp: {[Op.gte]: beginTime}},
                    {timestamp: {[Op.lt]: endTime}}]
            },
            raw: true
        })

        const[collateralOld, feeOld, collateralInfoNew, feeNew] = await Promise.all([
            cfx.getCollateralInfo(epochRange["minEpoch"]),
            cfx.getFeeBurnt(epochRange["minEpoch"]),
            cfx.getCollateralInfo(epochRange["maxEpoch"]),
            cfx.getFeeBurnt(epochRange["maxEpoch"])
        ])

        const burntStorageFee = BigFixed(collateralInfoNew.convertedStoragePoints)
            .sub(BigFixed(collateralOld.convertedStoragePoints)).divide(BigFixed(1024)).toNumber()
        const burntGasFee = BigFixed(feeNew).sub(BigFixed(feeOld)).toNumber()
        const burntStorageFeeTotal = BigFixed(collateralInfoNew.convertedStoragePoints).divide(BigFixed(1024)).toNumber()
        const burntGasFeeTotal = BigFixed(feeNew).toNumber()

        return {
            statType: statType,
            statTime: beginTime,
            burntStorageFee,
            burntGasFee,
            burntStorageFeeTotal,
            burntGasFeeTotal
        } as DailyBurntFeeStat
    }
}
