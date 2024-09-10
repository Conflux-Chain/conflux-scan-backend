import {Op} from 'sequelize'
import {IntervalType, TimerStat} from "./TimerStat";
import {DailyBurntFeeStat} from "../../model/DailyBurntFeeStat";
import {Epoch} from "../../model/Epoch";
import {StatApp} from "../../StatApp";
import {CONST} from "../common/constant";

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
        const {app: {cfx}} = this
        const lastStat = await DailyBurntFeeStat.findOne({
            where: {statType: this.baseInterval},
            order:[["statTime","desc"]],
            limit: 1
        });
        if(!lastStat) {
            let block
            try {
                block = await cfx.getBlockByEpochNumber(CONST.VOTE_PARAMS.storagePointProp[StatApp.networkId] - 1)
            } catch (err) {
                const msg = `${err}`
                if (msg.includes('expected a numbers with less than largest epoch number.')) {
                    throw new Error(`Epoch at which CIP107 enabled has not reached.`)
                }
                throw  err
            }
            const lastStat = {statTime: new Date(block.timestamp * 1000)}
            lastStat.statTime.setHours(lastStat.statTime.getHours() - 1, 0, 0, 0)
            return this.getStatRangeMin(lastStat, 60)
        }
        return this.getStatRangeMin(lastStat, 60);
    }

    /*
    total storage fee: convertedStoragePoints/1024 from cfx_getCollateralInfo
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
            app: { cfx: sdk, supressFullStateRpcErr }
        } = this

        const maxEpoch = await Epoch.findOne({where: {timestamp: {[Op.lt]: endTime}}, order: [['timestamp', 'desc']]})
        const[collateralInfoNew, feeNew] = await Promise.all([
            sdk.cfx.getCollateralInfo(maxEpoch.epoch).catch(e => {
                if(supressFullStateRpcErr && e.message.includes('out-of-bound StateAvailabilityBoundary')) {
                    return {convertedStoragePoints: 0}
                }
                throw e
            }),
            sdk.cfx.getFeeBurnt(maxEpoch.epoch).catch(e => {
                if(supressFullStateRpcErr && e.message.includes('out-of-bound StateAvailabilityBoundary')) {
                    return 0
                }
                throw e
            }),
        ])

        const statTime = this.getRangeBegin(beginTime, statType as IntervalType);
        const lastStat = await DailyBurntFeeStat.findOne({where: {statType, statTime}})
        const collateralOld = lastStat?.burntStorageFeeTotal || 0
        const feeOld = lastStat?.burntGasFeeTotal || 0

        const storageFeeTotal = BigFixed(collateralInfoNew.convertedStoragePoints).div(BigFixed(1024)).mul(BigFixed(1e18))
        const gasFeeTotal = BigFixed(feeNew)
        const storageFee = storageFeeTotal.sub(BigFixed(collateralOld))
        const gasFee = gasFeeTotal.sub(BigFixed(feeOld))

        return {
            statType: statType,
            statTime: beginTime,
            burntStorageFeeTotal: storageFeeTotal.toNumber(),
            burntGasFeeTotal: gasFeeTotal.toNumber(),
            burntStorageFee: storageFee.toNumber(),
            burntGasFee: gasFee.toNumber(),
        } as DailyBurntFeeStat
    }
}
