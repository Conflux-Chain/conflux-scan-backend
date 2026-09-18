import {Op, QueryTypes} from "sequelize";
import {FullTransaction} from "../../model/FullBlock";
import {DailyPartnerAddr, DailyPartnerStat, PartnerContract} from "../../model/PartnerChain";
import {sqlLogFn} from "../../model/Utils";

/**
 * Per-day aggregation of partner on-chain activity.
 *
 * Source of truth is `full_tx`: it holds every transaction from chain genesis
 * (nothing prunes it -- PruneService only trims `address_tx`), `gas` is the
 * gas *fee* in wei, and `status` is 0 for success / 1 for failure. Each row has
 * exactly one `toId`, so joining to `partner_contract` attributes a transaction
 * to at most one partner and `group by sourceId` needs no de-duplication.
 *
 * Only direct calls are attributed. Internal/proxy calls are not available on
 * this chain: `traceNotAvailable` is set and the `trace` table is never created.
 */

/** watermark: ISO timestamp of the next UTC day still to aggregate */
export const KEY_PARTNER_STAT_DAY = "KEY_PARTNER_STAT_DAY";

/**
 * How much of the address roster to keep. It is only there to answer
 * "distinct addresses over the last N days", so history beyond the window is
 * dead weight -- and it is not cheap: a single busy contract produced ~32k
 * distinct senders in one day, which is ~12M rows/year for that partner alone.
 * Keep enough headroom above the dashboard's 30d window to allow longer ones.
 */
export const ADDR_ROSTER_KEEP_DAYS = 120;

/**
 * A UTC instant as a MySQL DATETIME literal.
 *
 * Deliberately not `fmtDtUTC`, which appends ` +00:00`. MySQL tolerates that
 * suffix when coercing a string in a WHERE comparison -- which is the only way
 * every other stat module uses `fmtDtUTC` -- but rejects it with
 * ER_TRUNCATED_WRONG_VALUE when the value is written into a DATETIME column.
 * Here the same string is both inserted as `statTime` and compared against
 * `full_tx.createdAt`, so it has to be valid in both positions.
 */
function mysqlDtUTC(dt: Date): string {
    return dt.toISOString().replace('T', ' ').replace(/\..*$/, '');
}

function rosterCutoff(now = new Date()): Date {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ADDR_ROSTER_KEEP_DAYS);
    return d;
}

/** joins a day of full_tx onto the contracts that were registered that day */
const JOIN_ON = `
    join partner_contract pc
      on  pc.hex40id = t.toId
      and t.createdAt >= pc.effectiveFrom
      and (pc.effectiveTo is null or t.createdAt < pc.effectiveTo)`;

/**
 * Both statements are assembled on first use rather than at import time.
 * `getTableName()` reads `Model.sequelize`, which is only set once `register()`
 * has run, while this module is loaded through StatTask's import chain long
 * before `initModel()`. Evaluating it at module scope throws
 * `Cannot read properties of undefined (reading 'getQueryInterface')` and takes
 * the process down before it can connect to anything.
 */
let sqlStatCache: string = null;
let sqlAddrRosterCache: string = null;

function sqlStat(): string {
    if (sqlStatCache !== null) {
        return sqlStatCache;
    }
    sqlStatCache = `
insert into ${DailyPartnerStat.getTableName()}
    (sourceId, statTime, txSuccess, txFailed, gasFeeSum, gasFeeFailed,
     activeAddr, nativeValue, createdAt, updatedAt)
select pc.sourceId,
       ?                                                       as statTime,
       sum(t.status = 0)                                       as txSuccess,
       sum(t.status = 1)                                       as txFailed,
       sum(t.gas)                                              as gasFeeSum,
       sum(case when t.status = 1 then t.gas else 0 end)       as gasFeeFailed,
       count(distinct case when t.status = 0 then t.fromId end) as activeAddr,
       sum(case when t.status = 0 then t.dripValue else 0 end) as nativeValue,
       now(), now()
from ${FullTransaction.getTableName()} t ${JOIN_ON}
where t.createdAt >= ? and t.createdAt < ?
group by pc.sourceId
on duplicate key update
    txSuccess    = values(txSuccess),    txFailed     = values(txFailed),
    gasFeeSum    = values(gasFeeSum),    gasFeeFailed = values(gasFeeFailed),
    activeAddr   = values(activeAddr),   nativeValue  = values(nativeValue),
    updatedAt    = values(updatedAt)`;
    return sqlStatCache;
}

function sqlAddrRoster(): string {
    if (sqlAddrRosterCache !== null) {
        return sqlAddrRosterCache;
    }
    sqlAddrRosterCache = `
insert ignore into ${DailyPartnerAddr.getTableName()} (sourceId, statTime, addr)
select distinct pc.sourceId, ?, t.fromId
from ${FullTransaction.getTableName()} t ${JOIN_ON}
where t.createdAt >= ? and t.createdAt < ? and t.status = 0`;
    return sqlAddrRosterCache;
}

/**
 * Aggregate one UTC day. Idempotent: re-running overwrites that day's rows,
 * so a backfill and the live job can safely cover the same range.
 *
 * Returns the sourceIds that had activity, or null when nothing was registered
 * (callers still advance their watermark in that case).
 */
export async function statPartnerDay(dayStart: Date, dayEnd: Date): Promise<string[]> {
    const registered = await PartnerContract.count();
    if (registered === 0) {
        return [];
    }

    const begin = mysqlDtUTC(dayStart);
    const end = mysqlDtUTC(dayEnd);
    const replacements = [begin, begin, end];

    await DailyPartnerStat.sequelize.query(sqlStat(), {
        type: QueryTypes.INSERT, replacements, benchmark: true,
        logging: sqlLogFn(`[partner-stat]${begin}`),
    });
    // Skip days that a later prune would delete anyway -- a deep backfill would
    // otherwise write tens of millions of roster rows just to drop them.
    if (dayStart.getTime() >= rosterCutoff().getTime()) {
        await DailyPartnerAddr.sequelize.query(sqlAddrRoster(), {
            type: QueryTypes.INSERT, replacements, benchmark: true,
            logging: sqlLogFn(`[partner-addr]${begin}`),
        });
    }

    const rows = await DailyPartnerStat.findAll({
        attributes: ['sourceId'], where: {statTime: dayStart}, raw: true,
    });
    return rows.map(r => r.sourceId);
}

/**
 * Fill in the running totals for one day, carrying forward from each partner's
 * most recent earlier day.
 *
 * Done in JS rather than one UPDATE..SELECT because MySQL refuses to read the
 * table being updated (error 1093), and a partner with no traffic on a day has
 * no row at all, so "previous day" is not always yesterday.
 */
export async function updatePartnerCumulative(dayStart: Date, sourceIds: string[]) {
    for (const sourceId of sourceIds) {
        const [today, prev] = await Promise.all([
            DailyPartnerStat.findOne({where: {sourceId, statTime: dayStart}}),
            DailyPartnerStat.findOne({
                where: {sourceId, statTime: {[Op.lt]: dayStart}},
                order: [['statTime', 'desc']], limit: 1, raw: true,
            }),
        ]);
        if (!today) {
            continue;
        }
        const txSuccessCum = BigInt(prev?.txSuccessCum || 0) + BigInt(today.txSuccess || 0);
        const gasFeeSumCum = BigInt(prev?.gasFeeSumCum || 0) + BigInt(today.gasFeeSum || 0);
        await DailyPartnerStat.update(
            {txSuccessCum: txSuccessCum.toString() as any, gasFeeSumCum: gasFeeSumCum.toString()},
            {where: {sourceId, statTime: dayStart}},
        );
    }
}

/**
 * Drop roster rows that have aged out of the window. Deleted in bounded
 * batches so a first run after a long backfill cannot hold a huge transaction.
 */
export async function pruneAddrRoster(batch = 50_000): Promise<number> {
    const cutoff = rosterCutoff();
    let total = 0;
    let deleted: number;
    do {
        deleted = await DailyPartnerAddr.destroy({
            where: {statTime: {[Op.lt]: cutoff}}, limit: batch,
        });
        total += deleted;
    } while (deleted === batch);
    if (total) {
        console.log(`[partner-addr] pruned ${total} row(s) before ${cutoff.toISOString()}`);
    }
    return total;
}

/** one UTC day forward from `dayStart` */
export function nextDay(dayStart: Date): Date {
    const d = new Date(dayStart);
    d.setDate(d.getDate() + 1);
    return d;
}

/** most recent UTC midnight that is already complete */
export function lastCompleteDay(now = new Date()): Date {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
}
