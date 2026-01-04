import {QueryTypes} from 'sequelize'
import {CfxBalance} from "../../model/Balance";
import {DailyCfxHolder} from "../../model/DailyCfxHolder";
import {EpochHashCfxTransfer} from "../../CfxTransferSync";
import {StatType, TimerStat} from "./TimerStat";

export class StatTotalCfxHolder extends TimerStat{

    constructor(app: any) {
        super(app);
        this.baseInterval = StatType.TEN_MIN;
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
        return EpochHashCfxTransfer.sequelize.query(
            "select epoch from epoch_hash_cfx_transfer where createdAt >= ? order by createdAt asc limit 1",
            {
                type: QueryTypes.SELECT,
                replacements: [rangeEnd],
            }
        ).then((item: any) => {
            return item?.length ? item[0].epoch : undefined;
        });
    }

    public async stat(rangeBegin: Date, rangeEnd: Date) {
        const mStat = await this.statRaw(rangeBegin, rangeEnd);
        const dStat = {
            statDay: this.getRangeBegin(rangeEnd, StatType.DAY),
            statType: StatType.DAY,
            holderCount: mStat.holderCount,
        };

        const statArray = [mStat, dStat];
        await DailyCfxHolder.sequelize.transaction(async (dbTx) => {
            await DailyCfxHolder.destroy({
                where: {statType: dStat.statType, statDay: dStat.statDay}, transaction: dbTx,
            });
            await DailyCfxHolder.bulkCreate(statArray, {
                transaction: dbTx,
            });
        });
    }

    // ------------------------------- biz -----------------------------------
    public async statRaw(beginTime: Date, endTime: Date): Promise<DailyCfxHolder> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval);

        const holderCount = await CfxBalance.count({});

        return {
            statDay: beginTime, statType: intervalType, holderCount
        } as DailyCfxHolder;
    }
}