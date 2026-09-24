import {Op} from "sequelize";
import {hex40IdMap, idHex40Map} from "../../stat/model/HexMap";
import {
    DailyPartnerAddr,
    DailyPartnerStat,
    DailyPartnerTvl,
    LEN_SOURCE_ID,
    NATIVE_TOKEN_ID,
    Partner,
    PartnerAudit,
    PartnerContract,
} from "../../stat/model/PartnerChain";
import {getPartnerTvl} from "../../stat/service/partner/PartnerTvl";
import {ADDR_ROSTER_KEEP_DAYS} from "../../stat/service/partner/PartnerChainStat";
import {PartnerParamError, principalOf} from "../router/partnerAuth";

/**
 * Partner chain-metrics endpoints for the Solutions Hub dashboard.
 *
 * Conventions deliberately mirror the Router's admin usage APIs so the two
 * modules read the same way:
 *   - partner identity is `source_id` (the `X-0G-Source-Id` tag)
 *   - dates are YYYY-MM-DD, UTC, inclusive; both bounds or neither; omitted = lifetime
 *   - native amounts are integer strings in neuron/wei (1 0G = 1e18) -- parse
 *     with BigInt, never Number()
 *   - responses are {object: 'list', data: [...]}
 *
 * These bypass `setBody` on purpose: it emits the scan-native envelope
 * ({status,message,result} on EVM chains), which does not match the shape the
 * dashboard already consumes.
 */

const MAX_SOURCE_IDS = 100;
const MAX_RANGE_DAYS = 400;
/** batch cap for address parameters, matching the admin usage APIs */
const MAX_ADDRESSES = 100;
/**
 * Write batches get their own, larger cap: registration is expected to be
 * driven by automation on the caller's side, while the read filter stays at the
 * admin APIs' 100 for consistency with them.
 */
const MAX_REGISTER_ADDRESSES = 500;
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 1000;

/*
 * `count` is the number of rows this response carries, which is `data.length`
 * everywhere except `/partner/contracts`: there the rows are nested one level
 * down, so it passes the row count explicitly. Keeping `count` a row count is
 * what makes the documented `count < total` truncation check work.
 */
function listBody(ctx, data: any[], extra: object = {}, rowCount?: number) {
    ctx.body = {object: 'list', ...extra, count: rowCount ?? data.length, data};
}

function fail(code: string, message?: string): never {
    throw new PartnerParamError(code, message);
}

/** YYYY-MM-DD -> UTC midnight. Both bounds or neither, per the Router's contract. */
function parseDateRange(query): {from?: Date, to?: Date} {
    const {start_date, end_date} = query;
    if (!start_date && !end_date) {
        return {};
    }
    if (!start_date || !end_date) {
        fail('incomplete_date_range');
    }
    const from = new Date(`${start_date}T00:00:00.000Z`);
    // end_date is inclusive, so the exclusive upper bound is the next midnight
    const to = new Date(`${end_date}T00:00:00.000Z`);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        fail('invalid_date');
    }
    to.setUTCDate(to.getUTCDate() + 1);
    if (from.getTime() >= to.getTime()) {
        fail('invalid_date_range');
    }
    if ((to.getTime() - from.getTime()) / 86400_000 > MAX_RANGE_DAYS) {
        fail('date_range_too_large');
    }
    return {from, to};
}

function parseSourceIds(query, {required = false} = {}): string[] {
    const raw = (query.source_id || '').trim();
    if (!raw) {
        if (required) {
            fail('missing_source_id');
        }
        return [];
    }
    const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length > MAX_SOURCE_IDS) {
        fail('too_many_source_ids');
    }
    if (ids.some(id => id.length > LEN_SOURCE_ID)) {
        fail('invalid_source_id');
    }
    return ids;
}

/** `''` (a bare `?limit=`) counts as absent rather than as zero. */
function optionalNumber(v: any): number | undefined {
    const raw = (v ?? '').toString().trim();
    return raw === '' ? undefined : Number(raw);
}

/**
 * `limit` / `offset`, following the admin usage APIs' envelope.
 *
 * The default is the maximum rather than a small page size on purpose: these
 * endpoints returned complete result sets before paging existed, so a low
 * default would silently truncate every query already in use. `total` in the
 * envelope is what makes any truncation visible.
 */
function parsePaging(query): {limit: number, offset: number} {
    const limit = optionalNumber(query.limit) ?? DEFAULT_LIMIT;
    const offset = optionalNumber(query.offset) ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        fail('invalid_limit', `\`limit\` must be an integer between 1 and ${MAX_LIMIT}.`);
    }
    if (!Number.isInteger(offset) || offset < 0) {
        fail('invalid_offset', '`offset` must be a non-negative integer.');
    }
    return {limit, offset};
}

/**
 * Shape and batch-size validation, shared by the read filter and the write path.
 *
 * Rejects the whole list before anything is looked up or written: a caller
 * sending one malformed address in a batch of 500 should get a 400 naming it,
 * not a partial result.
 */
function validateAddressList(list: any[], cap: number): string[] {
    if (list.length > cap) {
        fail('too_many_addresses', `At most ${cap} addresses per request.`);
    }
    for (const a of list) {
        // a blank or malformed entry would resolve to no id and be reported as
        // `unknown_address`, which misdescribes it -- reject the shape up front
        if (typeof a !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(a.trim())) {
            fail(`invalid_address:${a}`);
        }
    }
    return list.map(a => a.trim().toLowerCase());
}

/** `address` as a single value or a comma batch, normalised to lowercase. */
function parseAddresses(query): string[] {
    const raw = (query.address || '').trim();
    if (!raw) {
        return [];
    }
    return validateAddressList(raw.split(',').map(s => s.trim()).filter(Boolean), MAX_ADDRESSES);
}

/**
 * Earliest day the address roster still holds. Windows older than this can only
 * be answered partially, which callers must be told about rather than left to
 * infer from a number that looks complete.
 */
function rosterEarliestDay(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ADDR_ROSTER_KEEP_DAYS);
    return d;
}

function dayString(v: Date | string): string {
    return (v instanceof Date ? v.toISOString() : new Date(v).toISOString()).slice(0, 10);
}

/** DECIMAL/BIGINT come back from mysql2 as strings; keep them that way. */
function intString(v: any): string {
    return (v === null || v === undefined) ? '0' : String(v);
}

function toRow(r: any) {
    return {
        source_id: r.sourceId,
        date: dayString(r.statTime),
        tx_success: Number(r.txSuccess),
        tx_failed: Number(r.txFailed),
        gas_fee: intString(r.gasFeeSum),
        gas_fee_failed: intString(r.gasFeeFailed),
        active_addresses: Number(r.activeAddr),
        native_value: intString(r.nativeValue),
        tx_success_cumulative: Number(r.txSuccessCum),
        gas_fee_cumulative: intString(r.gasFeeSumCum),
    };
}

/**
 * GET /partner/chain-metrics
 *   source_id  single id or comma batch (max 100); omitted = every partner
 *   start_date / end_date  YYYY-MM-DD UTC inclusive; omitted = lifetime
 *
 * Per-day time series. TVL is intentionally absent -- see the module notes.
 */
export async function listPartnerChainMetrics(ctx) {
    const query = ctx.request.query;
    const sourceIds = parseSourceIds(query);
    const {from, to} = parseDateRange(query);

    const where: any = {};
    if (sourceIds.length) {
        where.sourceId = {[Op.in]: sourceIds};
    }
    if (from) {
        where.statTime = {[Op.gte]: from, [Op.lt]: to};
    }

    const {limit, offset} = parsePaging(query);
    const {rows, count} = await DailyPartnerStat.findAndCountAll({
        where, order: [['statTime', 'asc'], ['sourceId', 'asc']], raw: true, limit, offset,
    });
    listBody(ctx, rows.map(toRow), {total: count, limit, offset});
}

/**
 * GET /partner/chain-metrics/summary
 *   period                 7d | 30d | 90d | all   (default 30d)
 *   start_date / end_date  YYYY-MM-DD UTC inclusive, as an alternative to period
 *   source_id              optional filter, comma batch
 *
 * One row per partner over the window. `active_addresses` is a distinct count
 * over the whole window, which is why this endpoint exists at all -- it cannot
 * be recomputed from the per-day series, since daily counts do not sum.
 *
 * That count is served from a roster kept for ADDR_ROSTER_KEEP_DAYS, so a
 * window reaching further back is answered from partial data. Rather than
 * quietly under-report, such a response carries
 * `active_addresses_partial: true` along with the earliest date it does cover.
 */
export async function getPartnerChainSummary(ctx) {
    const query = ctx.request.query;
    const sourceIds = parseSourceIds(query);
    const {from: explicitFrom, to: explicitTo} = parseDateRange(query);

    let period: string;
    let from: Date = null;
    let to: Date = null;

    if (explicitFrom) {
        // both given at once is ambiguous, and guessing which one the caller
        // meant would silently return a window they did not ask for
        if (query.period) {
            fail('period_with_date_range',
                'Send either `period` or a start_date/end_date pair, not both.');
        }
        period = 'custom';
        from = explicitFrom;
        to = explicitTo;
    } else {
        period = (query.period || '30d').toString();
        const days = {'7d': 7, '30d': 30, '90d': 90, 'all': 0}[period];
        if (days === undefined) {
            fail('invalid_period');
        }
        if (days) {
            from = new Date();
            from.setUTCHours(0, 0, 0, 0);
            from.setUTCDate(from.getUTCDate() - days);
        }
    }

    const where: any = {};
    if (from || to) {
        where.statTime = {};
        from && (where.statTime[Op.gte] = from);
        to && (where.statTime[Op.lt] = to);
    }
    if (sourceIds.length) {
        where.sourceId = {[Op.in]: sourceIds};
    }

    const rows = await DailyPartnerStat.findAll({where, raw: true});

    const agg = new Map<string, any>();
    for (const r of rows) {
        let e = agg.get(r.sourceId);
        if (!e) {
            e = {
                source_id: r.sourceId, tx_success: 0, tx_failed: 0,
                gas_fee: 0n, gas_fee_failed: 0n,
                tx_success_cumulative: 0, gas_fee_cumulative: '0', latest: null,
            };
            agg.set(r.sourceId, e);
        }
        e.tx_success += Number(r.txSuccess);
        e.tx_failed += Number(r.txFailed);
        e.gas_fee += BigInt(intString(r.gasFeeSum));
        e.gas_fee_failed += BigInt(intString(r.gasFeeFailed));
        // cumulative columns are running totals: the newest day in the window wins
        const t = new Date(r.statTime).getTime();
        if (e.latest === null || t > e.latest) {
            e.latest = t;
            e.tx_success_cumulative = Number(r.txSuccessCum);
            e.gas_fee_cumulative = intString(r.gasFeeSumCum);
        }
    }

    const activeMap = await distinctActiveAddresses(sourceIds, from, to);

    // `all`, or any window starting before the roster's horizon, is counted from
    // less data than the caller asked for
    const rosterFrom = rosterEarliestDay();
    const activePartial = !from || from.getTime() < rosterFrom.getTime();
    const data = [...agg.values()].map(e => {
        const total = e.tx_success + e.tx_failed;
        return {
            source_id: e.source_id,
            period,
            tx_success: e.tx_success,
            tx_failed: e.tx_failed,
            fail_rate: total ? Number((e.tx_failed / total).toFixed(6)) : 0,
            gas_fee: e.gas_fee.toString(),
            gas_fee_failed: e.gas_fee_failed.toString(),
            active_addresses: activeMap.get(e.source_id) || 0,
            active_addresses_partial: activePartial,
            tx_success_cumulative: e.tx_success_cumulative,
            gas_fee_cumulative: e.gas_fee_cumulative,
        };
    }).sort((a, b) => b.tx_success - a.tx_success);

    // one row per partner, so paging applies to the aggregate rather than to
    // the daily rows it was built from
    const {limit, offset} = parsePaging(query);
    listBody(ctx, data.slice(offset, offset + limit), {
        period,
        start_date: from ? dayString(from) : null,
        // `to` is the exclusive bound; report the inclusive day the caller asked for
        end_date: to ? dayString(new Date(to.getTime() - 86400_000)) : null,
        active_addresses_covered_from: dayString(activePartial ? rosterFrom : from),
        total: data.length,
        limit,
        offset,
    });
}

/** distinct addresses per partner over a window, from the daily roster */
async function distinctActiveAddresses(sourceIds: string[], from: Date, to: Date): Promise<Map<string, number>> {
    const where: any = {};
    if (sourceIds.length) {
        where.sourceId = {[Op.in]: sourceIds};
    }
    if (from || to) {
        where.statTime = {};
        from && (where.statTime[Op.gte] = from);
        to && (where.statTime[Op.lt] = to);
    }
    const rows: any[] = await DailyPartnerAddr.findAll({
        attributes: [
            'sourceId',
            [DailyPartnerAddr.sequelize.fn('count',
                DailyPartnerAddr.sequelize.literal('distinct addr')), 'cnt'],
        ],
        where, group: ['sourceId'], raw: true,
    });
    return new Map(rows.map(r => [r.sourceId, Number(r.cnt)]));
}

/**
 * GET /partner/tvl
 *   source_id  single id or comma batch; required (TVL is a live read, not a
 *              precomputed table, so an unbounded sweep is not offered)
 *
 * Current snapshot only. There is no TVL history and none can be built after
 * the fact -- both balance tables and the price table are current-state only.
 * `usd_complete: false` means some holding could not be priced and the USD
 * totals understate reality; the native amounts are always exact.
 */
export async function getPartnerTvlSnapshot(ctx) {
    const sourceIds = parseSourceIds(ctx.request.query, {required: true});
    const data = await getPartnerTvl(DailyPartnerStat.sequelize, sourceIds);
    listBody(ctx, data, {as_of: new Date().toISOString()});
}

/**
 * GET /partner/tvl/history
 *   source_id  required, single id or comma batch
 *   start_date / end_date  YYYY-MM-DD UTC inclusive; omitted = everything kept
 *
 * One row per (day, token). Gaps are expected and meaningful: a day is missing
 * when no snapshot could be taken close enough to that day's boundary, and it
 * can never be filled in afterwards because balances are current-state only.
 *
 * `price_usd` / `value_usd_micro` are null until a price source is configured
 * for the token; quantities are unaffected by that.
 */
export async function listPartnerTvlHistory(ctx) {
    const query = ctx.request.query;
    const sourceIds = parseSourceIds(query, {required: true});
    const {from, to} = parseDateRange(query);

    const where: any = {sourceId: {[Op.in]: sourceIds}};
    if (from) {
        where.statTime = {[Op.gte]: from, [Op.lt]: to};
    }
    const {limit, offset} = parsePaging(query);
    const {rows, count} = await DailyPartnerTvl.findAndCountAll({
        where, order: [['statTime', 'asc'], ['sourceId', 'asc'], ['tokenId', 'asc']],
        raw: true, limit, offset,
    });
    listBody(ctx, rows.map((r: any) => ({
        source_id: r.sourceId,
        date: dayString(r.statTime),
        as_of: new Date(r.asOf).toISOString(),
        token_id: Number(r.tokenId),
        is_native: Number(r.tokenId) === NATIVE_TOKEN_ID,
        symbol: r.symbol || '',
        amount: intString(r.amount),
        decimals: r.decimals == null ? null : Number(r.decimals),
        price_usd: r.priceUsd == null ? null : String(r.priceUsd),
        value_usd_micro: r.valueUsdMicro == null ? null : intString(r.valueUsdMicro),
        price_source: r.priceSource || '',
    })), {total: count, limit, offset});
}

/**
 * GET /partner/contracts
 *   source_id  optional filter, comma batch
 *   address    optional filter, comma batch (max 100) -- reverse lookup
 *
 * The registry is the only place a partner is linked to on-chain contracts --
 * the Router side attributes by request header and knows nothing about them.
 *
 * Addresses that resolve to no mapping are reported in `unmatched` rather than
 * dropped, so a caller can tell "not registered to any partner" apart from
 * "registered but has no metrics yet". An address the indexer has never seen
 * lands there too: for this endpoint that is a legitimate answer, not the
 * `unknown_address` error the write path returns.
 */
export async function listPartnerContracts(ctx) {
    const query = ctx.request.query;
    const sourceIds = parseSourceIds(query);
    const addresses = parseAddresses(query);
    const where: any = {};
    if (sourceIds.length) {
        where.sourceId = {[Op.in]: sourceIds};
    }
    const {limit, offset} = parsePaging(query);
    let unmatched: string[] = [];
    if (addresses.length) {
        // one batched IN, not a lookup per address
        const idByHex = await hex40IdMap(addresses);
        // never seen on chain at all
        unmatched = addresses.filter(a => !idByHex.has(a.slice(2)));
        const ids = [...idByHex.values()];
        if (!ids.length) {
            // no id to match on; skip the query rather than emitting `IN ()`
            listBody(ctx, [], {total: 0, limit, offset, unmatched});
            return;
        }
        // known on chain but mapped to no partner. Resolved before paging so the
        // answer does not change with `limit`.
        const mapped = await PartnerContract.findAll({
            where: {hex40id: {[Op.in]: ids}}, attributes: ['hex40id'], raw: true,
        });
        const mappedIds = new Set(mapped.map((r: any) => String(r.hex40id)));
        for (const [hex, id] of idByHex) {
            if (!mappedIds.has(String(id))) {
                unmatched.push(`0x${hex}`);
            }
        }
        where.hex40id = {[Op.in]: ids};
    }
    /*
     * Paging stays on address rows -- `limit` / `offset` / `total` / `count`
     * mean exactly what they meant before the rows were nested, so a caller's
     * existing paging keeps working and the query keeps its row bound. The
     * grouping is applied to the page that comes back, not to the whole
     * result set.
     *
     * The trade-off, agreed with the caller: a partner holding more addresses
     * than one page can carry is split across two consecutive pages, arriving
     * as two objects with the same `source_id`. Narrow with `source_id` to get
     * one partner whole. The (sourceId, id) order is total, so the split point
     * is deterministic and the two halves are contiguous.
     */
    const {rows, count} = await PartnerContract.findAndCountAll({
        where, order: [['sourceId', 'asc'], ['id', 'asc']], raw: true, limit, offset,
    });
    // BIGINT ids come back as string or number depending on the driver path,
    // so key the lookup on the string form rather than trusting either.
    const hexMap = await idHex40Map(rows.map(r => r.hex40id), true);
    const byId = new Map([...hexMap].map(([id, hex]) => [String(id), hex]));

    // Map keeps insertion order, and rows arrive ordered by sourceId, so the
    // groups come out in sourceId order without a second sort.
    const grouped = new Map<string, any>();
    for (const r of rows) {
        let g = grouped.get(r.sourceId);
        if (!g) {
            g = {source_id: r.sourceId, addresses: []};
            grouped.set(r.sourceId, g);
        }
        g.addresses.push({
            address: byId.get(String(r.hex40id)) || '',
            effective_from: new Date(r.effectiveFrom).toISOString(),
            effective_to: r.effectiveTo ? new Date(r.effectiveTo).toISOString() : null,
        });
    }
    listBody(ctx, [...grouped.values()],
        {total: count, limit, offset, ...(addresses.length ? {unmatched} : {})}, rows.length);
}

/**
 * POST /partner/contracts
 *   {source_id, name?, addresses: ["0x..", ..], effective_from?}
 *
 * Registering does not backfill by itself. The daily job only moves forward, so
 * run PartnerBackfill for the new contract's history -- the PRD's 24h window is
 * about that run, not about this call.
 */
export async function registerPartnerContracts(ctx) {
    const body = ctx.request.body || {};
    const sourceId = (body.source_id || '').trim();
    if (!sourceId || sourceId.length > LEN_SOURCE_ID) {
        fail('invalid_source_id');
    }
    const rawList: any[] = Array.isArray(body.addresses) ? body.addresses : [];
    if (!rawList.length) {
        fail('missing_addresses');
    }
    // duplicates within one batch would otherwise be looked up and counted twice
    const addresses = [...new Set(validateAddressList(rawList, MAX_REGISTER_ADDRESSES))];
    const effectiveFrom = body.effective_from
        ? new Date(body.effective_from) : new Date('1970-01-01T00:00:00.000Z');
    if (isNaN(effectiveFrom.getTime())) {
        fail('invalid_date');
    }

    // one query for the batch rather than a lookup per address
    const idByHex = await hex40IdMap(addresses);
    const resolved = addresses.map(address => {
        const hex40id = idByHex.get(address.slice(2));
        if (!hex40id) {
            // an address the indexer has never seen cannot be attributed
            fail(`unknown_address:${address}`);
        }
        return {address, hex40id};
    });
    const ids = resolved.map(r => r.hex40id);

    /*
     * Everything that writes happens in one transaction, and the conflict check
     * sits inside it. A rejected batch must leave nothing behind: the previous
     * shape created the partner record up front and then wrote mappings one at a
     * time, so a clash on the 50th address left the first 49 registered plus a
     * partner row -- which is exactly the failure a bulk caller would hit.
     */
    const created = await PartnerContract.sequelize.transaction(async (dbTx) => {
        const clashes: any[] = await PartnerContract.findAll({
            where: {hex40id: {[Op.in]: ids}, sourceId: {[Op.ne]: sourceId}, effectiveTo: null},
            attributes: ['hex40id'], raw: true, transaction: dbTx,
        });
        if (clashes.length) {
            const taken = new Set(clashes.map((c: any) => String(c.hex40id)));
            // overlapping windows would double count in the daily aggregation
            const first = resolved.find(r => taken.has(String(r.hex40id)));
            fail(`address_owned_by_other_partner:${first.address}`);
        }

        await Partner.findOrCreate({
            where: {sourceId}, defaults: {sourceId, name: (body.name || '').toString()},
            transaction: dbTx,
        });

        const already: any[] = await PartnerContract.findAll({
            where: {sourceId, effectiveFrom, hex40id: {[Op.in]: ids}},
            attributes: ['hex40id', 'effectiveTo'], raw: true, transaction: dbTx,
        });
        const have = new Set(already.map((e: any) => String(e.hex40id)));
        const fresh = resolved.filter(r => !have.has(String(r.hex40id)));
        if (fresh.length) {
            await PartnerContract.bulkCreate(
                fresh.map(r => ({sourceId, hex40id: r.hex40id, effectiveFrom})) as any,
                {transaction: dbTx},
            );
        }

        /*
         * A row that already exists but whose window was closed has to be
         * reopened. Without this, re-registering something previously
         * de-registered matched here, was reported as an idempotent
         * `created: false`, and stayed de-registered -- the caller sees success
         * while the aggregation keeps ignoring the contract. The default
         * `effectiveFrom` is the epoch, so this is the path any plain
         * re-registration takes.
         */
        const shut = already.filter((e: any) => e.effectiveTo !== null).map((e: any) => e.hex40id);
        if (shut.length) {
            await PartnerContract.update({effectiveTo: null}, {
                where: {sourceId, effectiveFrom, hex40id: {[Op.in]: shut}}, transaction: dbTx,
            });
        }
        const reopened = new Set(shut.map(String));

        // re-registering a mapping that is already open stays a success with
        // created:false and reactivated:false
        return resolved.map(r => ({
            address: r.address,
            created: !have.has(String(r.hex40id)),
            reactivated: reopened.has(String(r.hex40id)),
        }));
    });

    const who = principalOf(ctx);
    await PartnerAudit.create({
        action: 'register_contract',
        sourceId,
        actor: who.actor,
        rateKeyId: who.rateKeyId,
        detail: JSON.stringify({
            addresses: created.map(c => c.address),
            created: created.filter(c => c.created).length,
            reactivated: created.filter(c => c.reactivated).length,
            effective_from: effectiveFrom.toISOString(),
        }).slice(0, 1024),
        ip: who.ip,
    }).catch(e => {
        // the registration already happened; losing the log must not 500 the caller
        console.log(`failed to write partner audit:`, e);
    });

    listBody(ctx, created, {source_id: sourceId});
}

/** The next UTC midnight -- the boundary the daily aggregation works in. */
function nextUtcMidnight(now = new Date()): Date {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
}

/**
 * DELETE /partner/contracts
 *   {source_id, addresses: ["0x..", ..], delete_on?}
 *
 * Closes a mapping's window instead of deleting the row. The aggregation joins
 * on `effectiveTo is null or t.createdAt < effectiveTo`, so attribution stops
 * from that instant onward while the history that was correct at the time stays
 * attributed -- and the row remains as the record of who was credited when.
 *
 * The request field is `delete_on`, not `effective_to`, even though it is what
 * the `effectiveTo` column ends up holding. `GET /partner/contracts` already
 * returns `effective_to` as a property of the mapping, where a far-future value
 * reads as "valid for a long time"; the same name on this call means the
 * opposite -- when attribution *stops*. Sending `effective_to` here is rejected
 * rather than quietly falling back to the default.
 *
 * `delete_on` defaults to the next UTC midnight so the current day is
 * attributed in full and the window closes on the same boundary the daily job
 * works in. The write itself is immediate; nothing is queued. Pass an explicit
 * timestamp for a real hand-off; a mid-day value gives that day partial
 * attribution, which is correct for a hand-off and usually not what you want
 * when undoing a mistake.
 *
 * Days already written to `daily_partner_stat` are NOT recomputed. Undoing a
 * wrong mapping is therefore two operations: this call, then a backfill over
 * the affected range.
 *
 * Once the window is closed the conflict check stops seeing the row, so another
 * partner can claim the same contract.
 */
export async function deregisterPartnerContracts(ctx) {
    const body = ctx.request.body || {};
    const sourceId = (body.source_id || '').trim();
    if (!sourceId || sourceId.length > LEN_SOURCE_ID) {
        fail('invalid_source_id');
    }
    const rawList: any[] = Array.isArray(body.addresses) ? body.addresses : [];
    if (!rawList.length) {
        fail('missing_addresses');
    }
    const addresses = [...new Set(validateAddressList(rawList, MAX_REGISTER_ADDRESSES))];
    if (body.effective_to !== undefined) {
        fail('use_delete_on',
            'On this call the field is `delete_on` -- the instant attribution stops. ' +
            '`effective_to` is what `GET /partner/contracts` reports about a mapping, ' +
            'where a far-future value means the opposite.');
    }
    const effectiveTo = body.delete_on ? new Date(body.delete_on) : nextUtcMidnight();
    if (isNaN(effectiveTo.getTime())) {
        fail('invalid_date');
    }
    // A `delete_on` far in the future leaves the window open and de-registers
    // nothing, while still answering 200 -- the worst kind of failure. Reject it
    // rather than let a caller who meant "indefinitely" get a silent no-op.
    if (effectiveTo.getTime() - Date.now() > MAX_RANGE_DAYS * 86400_000) {
        fail('delete_on_too_far',
            `\`delete_on\` is more than ${MAX_RANGE_DAYS} days out, which would leave the ` +
            'mapping attributed. Omit the field to stop at the next UTC midnight.');
    }

    const idByHex = await hex40IdMap(addresses);
    const resolved = addresses.map(address => {
        const hex40id = idByHex.get(address.slice(2));
        if (!hex40id) {
            fail(`unknown_address:${address}`);
        }
        return {address, hex40id};
    });
    const ids = resolved.map(r => r.hex40id);

    const closed = await PartnerContract.sequelize.transaction(async (dbTx) => {
        const rows: any[] = await PartnerContract.findAll({
            where: {sourceId, hex40id: {[Op.in]: ids}},
            attributes: ['hex40id', 'effectiveTo'], raw: true, transaction: dbTx,
        });
        const mine = new Set(rows.map((r: any) => String(r.hex40id)));
        // an address this partner was never credited for is a caller mistake,
        // not a no-op -- reject the batch rather than half-applying it
        const notMine = resolved.filter(r => !mine.has(String(r.hex40id)));
        if (notMine.length) {
            fail(`not_registered:${notMine[0].address}`);
        }
        const open = new Set(rows.filter((r: any) => r.effectiveTo === null)
            .map((r: any) => String(r.hex40id)));
        if (open.size) {
            await PartnerContract.update({effectiveTo}, {
                where: {sourceId, hex40id: {[Op.in]: [...open].map(Number)}, effectiveTo: null},
                transaction: dbTx,
            });
        }
        /*
         * An already-closed window is left alone, so a retry is a safe no-op.
         *
         * The response says `effective_to` while the request said `delete_on`
         * on purpose: the request expresses intent, the response reports the
         * mapping's resulting state -- the same field, with the same meaning,
         * that `GET /partner/contracts` returns for it.
         */
        return resolved.map(r => ({
            address: r.address,
            closed: open.has(String(r.hex40id)),
            effective_to: effectiveTo.toISOString(),
        }));
    });

    const who = principalOf(ctx);
    await PartnerAudit.create({
        action: 'deregister_contract',
        sourceId,
        actor: who.actor,
        rateKeyId: who.rateKeyId,
        detail: JSON.stringify({
            addresses: closed.map(c => c.address),
            closed: closed.filter(c => c.closed).length,
            effective_to: effectiveTo.toISOString(),
        }).slice(0, 1024),
        ip: who.ip,
    }).catch(e => {
        console.log(`failed to write partner audit:`, e);
    });

    listBody(ctx, closed, {source_id: sourceId});
}
