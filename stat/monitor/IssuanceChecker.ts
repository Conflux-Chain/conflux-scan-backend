import {KEY_ISSUANCE_LAST_SEEN, KV} from "../model/KV";
import {sumWithdrawals} from "../service/ZGSupply";
import {ConfigInstance, NoCoreSpace} from "../config/StatConfig";
import {StuckChecker} from "./Monitor";

const DRIP = BigInt(1e18);

/**
 * Issuance is the only external input the published supply still has.
 *
 * `total = genesisSupply + sumBlockReward`, and sumBlockReward comes from one consensus
 * layer endpoint. Nothing cross-checks it any more: the ledger-by-ledger reading that
 * used to needed totalStakes and balance(0x0), and neither reaches a published figure
 * now. So if that endpoint starts answering a stale or frozen number, the supply goes
 * wrong quietly and in a way that looks entirely plausible.
 *
 * That is exactly how block_withdraws failed. It froze on 2026-04-30, kept answering the
 * figure it had, and nobody noticed for 157 days by which point it was 151M short.
 *
 * Issuance has a shape worth checking: it only ever rises, and it rises at a rate set by
 * the block reward and the block time rather than by anything variable. A reading that
 * stops rising, goes backwards, or changes pace is the signal.
 */

// ~2.444 0G a block over ~0.89s blocks, measured on mainnet in October 2026. Expected
// rather than enforced: a schedule change should move this constant, not fire an alert
// forever, which is why the alert says what it measured.
const EXPECTED_DAILY = 238_373;
const TOLERANCE = 0.20;

// Below this the quotient is mostly measurement noise -- the two readings are taken at
// whatever moment the periodic task happens to run, and a minute of skew on a short
// window swamps a 20% band.
const MIN_WINDOW_MS = 30 * 60 * 1000;

const checker = new StuckChecker('supply-issuance', 10);

interface LastSeen {
    reward: string;
    atMs: number;
}

/**
 * Compare issuance against the last reading. Returns the message it alerted with, or
 * undefined, so a caller can test it without a DingTalk token configured.
 */
export async function checkIssuance(): Promise<string | undefined> {
    if (!NoCoreSpace) {
        return;
    }

    const {rewards, message} = await sumWithdrawals();
    if (message) {
        // The endpoint itself is unreachable, which calculateEvmPosSupply already reports
        // as withdrawalMessage. Say so here too: that field is on a response nobody reads
        // unless they are already suspicious.
        return alert(`cannot read issuance: ${message}`);
    }

    const now = Date.now();
    const previous = await loadLastSeen();
    await KV.saveNumber(KEY_ISSUANCE_LAST_SEEN, JSON.stringify({reward: `${rewards}`, atMs: now} as LastSeen));

    if (!previous) {
        console.log(`${__filename} first reading, issuance ${fmt(rewards)} 0G`);
        return;
    }

    const elapsedMs = now - previous.atMs;
    const delta = rewards - BigInt(previous.reward);

    if (delta < 0n) {
        return alert(`issuance went backwards by ${fmt(-delta)} 0G over ${mins(elapsedMs)}`
            + ` -- the consensus layer is answering an older state than it was`);
    }
    if (elapsedMs < MIN_WINDOW_MS) {
        // Too short to judge the rate, but a frozen reading is still a frozen reading.
        if (delta === 0n) {
            return alert(`issuance has not moved in ${mins(elapsedMs)}, still ${fmt(rewards)} 0G`);
        }
        return ok();
    }
    if (delta === 0n) {
        return alert(`issuance has not moved in ${mins(elapsedMs)}, still ${fmt(rewards)} 0G`
            + ` -- expected about ${fmt(expectedOver(elapsedMs))} 0G`);
    }

    const perDay = Number(delta * 1000n / DRIP) / 1000 * (86_400_000 / elapsedMs);
    const drift = (perDay - EXPECTED_DAILY) / EXPECTED_DAILY;
    if (Math.abs(drift) > TOLERANCE) {
        return alert(`issuance is running at ${perDay.toLocaleString('en-US', {maximumFractionDigits: 0})} 0G/day`
            + ` over the last ${mins(elapsedMs)}, ${(drift * 100).toFixed(1)}% off the expected`
            + ` ${EXPECTED_DAILY.toLocaleString('en-US')}`);
    }

    console.log(`${__filename} issuance ok, ${perDay.toFixed(0)} 0G/day over ${mins(elapsedMs)}`);
    return ok();
}

// StuckChecker alerts once the same complaint has stood for its threshold, repeats hourly
// after that, and sends a resolved message when ok() follows an alert. Two consecutive
// bad readings is the bar here, since this runs hourly.
function alert(msg: string): string {
    console.log(`${__filename} ${msg}`);
    checker.push(msg);
    return msg;
}

function ok(): undefined {
    checker.ok();
    return undefined;
}

async function loadLastSeen(): Promise<LastSeen | undefined> {
    const raw = await KV.getString(KEY_ISSUANCE_LAST_SEEN, '');
    if (!raw) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw) as LastSeen;
        return parsed?.reward && parsed?.atMs ? parsed : undefined;
    } catch (e) {
        console.log(`${__filename} ignoring unreadable last reading:`, raw);
        return undefined;
    }
}

function expectedOver(elapsedMs: number): bigint {
    return BigInt(Math.round(EXPECTED_DAILY * elapsedMs / 86_400_000)) * DRIP;
}

function fmt(drip: bigint): string {
    return (Number(drip * 100n / DRIP) / 100).toLocaleString('en-US', {maximumFractionDigits: 2});
}

function mins(ms: number): string {
    const m = Math.round(ms / 60_000);
    return m < 120 ? `${m}m` : `${(m / 60).toFixed(1)}h`;
}

// node stat/monitor/IssuanceChecker.js
async function main() {
    const {loadConfig} = require("../config/StatConfig");
    const {createDB} = require("../service/DBProvider");
    const config = loadConfig('Prod');
    KV.register(createDB(config.databaseRW));
    console.log(`validatorRpc: ${ConfigInstance.validatorRpc}`);
    const msg = await checkIssuance();
    console.log(msg ? `ALERT: ${msg}` : `no alert`);
    process.exit(0);
}

if (module === require.main) {
    main();
}
