import {QueryTypes} from "sequelize";
import {scientificToBigInt} from "../watcher/BalanceService";
import {DailyPartnerTvl, NATIVE_TOKEN_ID} from "../../model/PartnerChain";

/**
 * Current TVL snapshot per partner: what its registered contracts hold right now.
 *
 * Snapshot only -- there is no history and none can be reconstructed. Both
 * `cfx_balance` and `token_balance` are upsert-over-write current state, and
 * `token_quote` keeps no price series, so a per-day TVL series can only be
 * accumulated going forward, never backfilled.
 *
 * Two balance tables, two different unit conventions -- getting this wrong is
 * silent and wrong by 18 orders of magnitude:
 *   - cfx_balance.balance  is ALREADY scaled to whole 0G (BalanceWatcher runs
 *     drip2cfx/formatUnits before saving), DECIMAL(36,18)
 *   - token_balance.balance is RAW uint256, unscaled, varchar -- the same unit
 *     the chain's balanceOf returns, which is why TokenQuery can swap a live
 *     balanceOf straight into that field
 */

const WEI = 10n ** 18n;
const USD_MICRO = 1_000_000n;

export interface ITokenHolding {
    token_id: number
    contract: string
    symbol: string
    decimals: number
    amount: string          // raw, unscaled
    price_usd: string       // '' when unknown
    value_usd_micro: string // '0' when price unknown
}

export interface IPartnerTvl {
    source_id: string
    contract_count: number
    native_amount: string       // neuron/wei, same unit as gas fees
    native_value_usd_micro: string
    tokens: ITokenHolding[]
    total_usd_micro: string
    /** false when anything held has no price -- the USD figures understate TVL */
    usd_complete: boolean
}

/**
 * Parse a decimal string into an integer scaled by 1e6, without going through
 * a float. Truncates below micro precision.
 */
function toMicro(v: string | number | null | undefined): bigint {
    if (v === null || v === undefined || v === '') {
        return 0n;
    }
    const s = String(v).trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) {
        return 0n;
    }
    const neg = s.startsWith('-');
    const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
    const frac = (f + '000000').slice(0, 6);
    const out = BigInt(i) * USD_MICRO + BigInt(frac);
    return neg ? -out : out;
}

/** whole-0G decimal string -> neuron/wei integer, exact (no float) */
function cfxToWei(v: string | number | null | undefined): bigint {
    if (v === null || v === undefined || v === '') {
        return 0n;
    }
    const s = String(v).trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) {
        return 0n;
    }
    const neg = s.startsWith('-');
    const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
    const frac = (f + '000000000000000000').slice(0, 18);
    const out = BigInt(i) * WEI + BigInt(frac);
    return neg ? -out : out;
}

const SQL_NATIVE = `
select pc.sourceId, b.balance
from partner_contract pc
join cfx_balance b on b.addressId = pc.hex40id
where pc.effectiveTo is null and pc.sourceId in (:sourceIds)`;

const SQL_TOKENS = `
select pc.sourceId, tb.contractId, tb.balance,
       t.base32, t.symbol, t.decimals, t.price
from partner_contract pc
join token_balance tb on tb.addressId = pc.hex40id
left join token t on t.hex40id = tb.contractId
where pc.effectiveTo is null and pc.sourceId in (:sourceIds)`;

const SQL_CONTRACT_COUNT = `
select sourceId, count(*) as n
from partner_contract
where effectiveTo is null and sourceId in (:sourceIds)
group by sourceId`;

const SQL_REGISTERED_SOURCES = `
select distinct sourceId from partner_contract where effectiveTo is null`;

/**
 * How far past a day boundary a snapshot may still be taken. Balances are read
 * live, so a sample taken long after the boundary describes the wrong moment --
 * better to leave a gap in the series than to record a value that silently
 * belongs to a different day.
 */
export const TVL_MAX_LAG_MS = 2 * 60 * 60 * 1000;

/** every partner with at least one live contract, whether or not it saw traffic */
export async function listRegisteredSourceIds(sequelize): Promise<string[]> {
    const rows: any[] = await sequelize.query(SQL_REGISTERED_SOURCES, {
        type: QueryTypes.SELECT, raw: true,
    });
    return rows.map(r => r.sourceId);
}

/**
 * `cfx_balance` also carries `stakingBalance`/`total`, but only `balance` is
 * written straight from drip2cfx; `total` is computed in a path that is not
 * exercised on this chain, so it is deliberately not used here.
 */
export async function getPartnerTvl(sequelize, sourceIds: string[]): Promise<IPartnerTvl[]> {
    if (!sourceIds.length) {
        return [];
    }
    const opts = {type: QueryTypes.SELECT, raw: true, replacements: {sourceIds}};
    const [natives, tokens, counts]: any[][] = await Promise.all([
        sequelize.query(SQL_NATIVE, opts),
        sequelize.query(SQL_TOKENS, opts),
        sequelize.query(SQL_CONTRACT_COUNT, opts),
    ]);

    const out = new Map<string, IPartnerTvl>();
    const ensure = (sourceId: string): IPartnerTvl => {
        let e = out.get(sourceId);
        if (!e) {
            e = {
                source_id: sourceId, contract_count: 0,
                native_amount: '0', native_value_usd_micro: '0',
                tokens: [], total_usd_micro: '0', usd_complete: true,
            };
            out.set(sourceId, e);
        }
        return e;
    };

    for (const row of counts) {
        ensure(row.sourceId).contract_count = Number(row.n);
    }

    // native: summed in JS rather than SQL so the wei conversion stays exact
    const nativeSum = new Map<string, bigint>();
    for (const row of natives) {
        const prev = nativeSum.get(row.sourceId) || 0n;
        nativeSum.set(row.sourceId, prev + cfxToWei(row.balance));
    }
    for (const [sourceId, wei] of nativeSum) {
        ensure(sourceId).native_amount = wei.toString();
    }

    // tokens: one contract may hold the same token via several addresses
    const perToken = new Map<string, Map<string, any>>();
    for (const row of tokens) {
        const bucket = perToken.get(row.sourceId) || new Map();
        perToken.set(row.sourceId, bucket);
        const key = String(row.contractId);
        const prev = bucket.get(key);
        // SUM() in SQL would coerce the varchar to double and lose precision
        const amount = (prev?.amount || 0n) + scientificToBigInt(row.balance);
        bucket.set(key, {
            amount,
            tokenId: Number(row.contractId),
            contract: row.base32 || '',
            symbol: row.symbol || '',
            decimals: row.decimals == null ? null : Number(row.decimals),
            price: row.price,
        });
    }

    for (const [sourceId, bucket] of perToken) {
        const e = ensure(sourceId);
        let totalMicro = 0n;
        for (const t of bucket.values()) {
            const priceMicro = toMicro(t.price);
            let valueMicro = 0n;
            if (priceMicro > 0n && t.decimals != null) {
                valueMicro = (t.amount * priceMicro) / (10n ** BigInt(t.decimals));
            } else {
                // unpriced or unknown decimals -> cannot value this holding
                e.usd_complete = false;
            }
            totalMicro += valueMicro;
            e.tokens.push({
                token_id: t.tokenId,
                contract: t.contract,
                symbol: t.symbol,
                decimals: t.decimals,
                amount: t.amount.toString(),
                price_usd: t.price == null ? '' : String(t.price),
                value_usd_micro: valueMicro.toString(),
            });
        }
        e.total_usd_micro = totalMicro.toString();
    }

    // No price feed exists for the native token on this chain (token_quote is
    // empty and nothing else publishes one), so native value is never in USD.
    for (const e of out.values()) {
        if (e.native_amount !== '0') {
            e.usd_complete = false;
        }
        e.tokens.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''));
    }

    return [...out.values()];
}

/**
 * Persist a TVL snapshot attributed to `statTime` (a UTC midnight).
 *
 * Returns the number of rows written, or -1 when the snapshot was skipped
 * because the sample would have been too far from the boundary to represent it.
 * Skipping is the correct outcome for a catch-up run or a backfill: the balance
 * tables only hold current state, so an old day cannot be sampled after the fact.
 */
export async function snapshotPartnerTvl(sequelize, statTime: Date, now = new Date()): Promise<number> {
    const lag = now.getTime() - statTime.getTime();
    if (lag < 0 || lag > TVL_MAX_LAG_MS) {
        console.log(`[partner-tvl] skip ${statTime.toISOString()}, sampled ${Math.round(lag / 60000)}min off boundary`);
        return -1;
    }

    const sourceIds = await listRegisteredSourceIds(sequelize);
    if (!sourceIds.length) {
        return 0;
    }
    const tvl = await getPartnerTvl(sequelize, sourceIds);

    const rows = [];
    for (const p of tvl) {
        if (p.native_amount !== '0') {
            rows.push({
                sourceId: p.source_id, statTime, asOf: now,
                tokenId: NATIVE_TOKEN_ID, amount: p.native_amount, decimals: 18,
                symbol: '', priceUsd: null, valueUsdMicro: null, priceSource: '',
            });
        }
        for (const t of p.tokens) {
            if (t.amount === '0') {
                continue;
            }
            rows.push({
                sourceId: p.source_id, statTime, asOf: now,
                tokenId: t.token_id, amount: t.amount, decimals: t.decimals,
                symbol: t.symbol || '',
                // no token on this chain has a price configured yet; the columns
                // exist so history can be valued later instead of re-collected
                priceUsd: t.price_usd || null,
                valueUsdMicro: t.price_usd ? t.value_usd_micro : null,
                priceSource: t.price_usd ? 'token.price' : '',
            });
        }
    }
    if (!rows.length) {
        return 0;
    }
    await DailyPartnerTvl.bulkCreate(rows as any, {
        updateOnDuplicate: ['asOf', 'amount', 'decimals', 'symbol',
            'priceUsd', 'valueUsdMicro', 'priceSource', 'updatedAt'],
    });
    console.log(`[partner-tvl] ${statTime.toISOString()} wrote ${rows.length} row(s) for ${tvl.length} partner(s)`);
    return rows.length;
}
