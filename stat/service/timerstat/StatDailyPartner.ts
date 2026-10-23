import {Op} from "sequelize";
import {Epoch} from "../../model/Epoch";
import {KV} from "../../model/KV";
import {DailyPartnerStat} from "../../model/PartnerChain";
import {
    KEY_PARTNER_STAT_DAY,
    nextDay,
    pruneAddrRoster,
    statPartnerDay,
    updatePartnerCumulative,
} from "../partner/PartnerChainStat";
import {snapshotPartnerTvl} from "../partner/PartnerTvl";
import {StatType, TimerStat} from "./TimerStat";

/**
 * Daily partner on-chain stats, one UTC day per pass.
 *
 * The watermark lives in KV rather than being derived from the newest row of
 * `daily_partner_stat`: a day on which no registered partner saw traffic writes
 * no rows at all, and deriving the range from the table would then re-scan the
 * same day forever.
 */
export class StatDailyPartner extends TimerStat {

    constructor(app: any) {
        super(app);
        this.baseInterval = StatType.DAY;
    }

    public bizAlias(): string {
        return `${DailyPartnerStat.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const saved = await KV.getString(KEY_PARTNER_STAT_DAY, '');
        let rangeBegin: Date;
        if (saved) {
            rangeBegin = new Date(saved);
        } else {
            rangeBegin = new Date(this.minDbTime);
            rangeBegin.setHours(0, 0, 0, 0);
        }
        return {rangeBegin, rangeEnd: nextDay(rangeBegin)};
    }

    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        return Epoch.findOne({
            attributes: ['epoch'],
            where: {timestamp: {[Op.gte]: rangeEnd}},
            order: [['timestamp', 'asc']],
            limit: 1,
        }).then(item => item?.epoch);
    }

    public async stat(rangeBegin: Date, rangeEnd: Date) {
        const sourceIds = await statPartnerDay(rangeBegin, rangeEnd);
        await updatePartnerCumulative(rangeBegin, sourceIds);
        await KV.upsert({key: KEY_PARTNER_STAT_DAY, value: rangeEnd.toISOString()});
        // TVL is sampled live, so it is attributed to the boundary we just
        // crossed and only recorded when this run is close enough to it.
        await snapshotPartnerTvl(DailyPartnerStat.sequelize, rangeEnd);
        await pruneAddrRoster();
        console.log(`[${this.bizAlias()}] ${rangeBegin.toISOString()} done, ${sourceIds.length} partner(s)`);
    }
}
