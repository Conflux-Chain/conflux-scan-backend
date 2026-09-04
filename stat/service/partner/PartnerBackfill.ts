// Backfill partner daily stats from history.
//
//   node stat/service/partner/PartnerBackfill.js [fromDate] [toDate] [sleepMs]
//
//   fromDate/toDate  YYYY-MM-DD, UTC, inclusive-exclusive on the end.
//                    Defaults: earliest day in full_tx .. last complete UTC day.
//   sleepMs          pause between days, to keep load off the primary. Default 200.
//
// Safe to re-run: every day is written with `on duplicate key update`, so a
// partial run just resumes. Cumulative columns are recomputed as it walks
// forward, which is why the range must start no later than the first day the
// partner had traffic -- starting mid-history would understate the totals.

import {KV} from "../../model/KV";
import {FullTransaction} from "../../model/FullBlock";
import {PartnerContract} from "../../model/PartnerChain";
import {sleep} from "../tool/ProcessTool";
import {init} from "../tool/FixDailyTokenStat";
import {
    KEY_PARTNER_STAT_DAY,
    lastCompleteDay,
    nextDay,
    statPartnerDay,
    updatePartnerCumulative,
} from "./PartnerChainStat";

function parseDay(s: string): Date {
    const d = new Date(`${s}T00:00:00.000Z`);
    if (isNaN(d.getTime())) {
        throw new Error(`bad date [${s}], want YYYY-MM-DD`);
    }
    return d;
}

async function earliestTxDay(): Promise<Date> {
    const first = await FullTransaction.findOne({
        attributes: ['createdAt'], order: [['createdAt', 'asc']], limit: 1, raw: true,
    });
    if (!first) {
        throw new Error(`no rows in ${FullTransaction.getTableName()}`);
    }
    const d = new Date(first.createdAt);
    d.setHours(0, 0, 0, 0);
    return d;
}

export async function backfill(from: Date, to: Date, sleepMs: number) {
    const registered = await PartnerContract.count();
    if (registered === 0) {
        console.log(`no rows in ${PartnerContract.getTableName()}, nothing to attribute. register contracts first.`);
        return;
    }
    const totalDays = Math.round((to.getTime() - from.getTime()) / 86400_000);
    console.log(`backfill ${from.toISOString()} .. ${to.toISOString()} (${totalDays} days), ${registered} contract(s)`);

    let day = new Date(from);
    let done = 0;
    while (day.getTime() < to.getTime()) {
        const end = nextDay(day);
        const started = Date.now();
        const sourceIds = await statPartnerDay(day, end);
        await updatePartnerCumulative(day, sourceIds);
        done++;
        console.log(`[${done}/${totalDays}] ${day.toISOString().slice(0, 10)} ` +
            `${sourceIds.length} partner(s) ${Date.now() - started}ms`);
        day = end;
        sleepMs && await sleep(sleepMs);
    }

    // hand the watermark to StatDailyPartner so it continues from here
    await KV.upsert({key: KEY_PARTNER_STAT_DAY, value: to.toISOString()});
    console.log(`backfill done, watermark set to ${to.toISOString()}`);
}

async function main() {
    const [, , fromArg, toArg, sleepArg] = process.argv;
    await init();

    const from = fromArg ? parseDay(fromArg) : await earliestTxDay();
    const to = toArg ? parseDay(toArg) : lastCompleteDay();
    const sleepMs = sleepArg === undefined ? 200 : Number(sleepArg);
    if (from.getTime() >= to.getTime()) {
        throw new Error(`empty range: ${from.toISOString()} >= ${to.toISOString()}`);
    }

    await backfill(from, to, sleepMs);
}

if (module === require.main) {
    main().then(() => {
        return KV.sequelize?.close();
    }).then(() => {
        process.exit(0);
    }).catch(err => {
        console.log(`partner backfill failed:`, err);
        process.exit(9);
    });
}
