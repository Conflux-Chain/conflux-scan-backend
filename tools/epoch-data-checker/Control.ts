import * as os from 'os';
import {QueryTypes} from 'sequelize';
import {KV} from '../../stat/model/KV';

export const ENABLED = 'DATA_CHECK_ENABLED';
export const LEASE = 'DATA_CHECK_LEASE';
export const LAST_ERROR = 'DATA_CHECK_LAST_ERROR';
export const RATE_FORWARD = 'DATA_CHECK_FORWARD_RATE';
export const RATE_BACKWARD = 'DATA_CHECK_BACKWARD_RATE';
const owner = `${os.hostname()}:${process.pid}`;
const leaseMs = 30_000;

function processAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

export async function setEnabled(value: boolean) {
    await KV.upsert({key: ENABLED, value: value ? 'true' : 'false'});
}
export async function isEnabled() { return KV.getSwitch(ENABLED); }
export async function leaseOwner() {
    return KV.getString(LEASE, '');
}
export async function acquireLease(): Promise<boolean> {
    const sequelize = KV.sequelize;
    return sequelize.transaction(async tx => {
        const row: any = await KV.findOne({where: {key: LEASE}, transaction: tx, lock: tx.LOCK.UPDATE});
        const now = Date.now();
        let current: any = {};
        try { current = row?.value ? JSON.parse(row.value) : {}; } catch (_) {}
        if (current.owner && current.owner !== owner && Number(current.expiresAt) > now) {
            // A Ctrl-C or host restart can leave the lease record behind. If
            // it belongs to this host and its PID is gone, take it over now;
            // other live hosts remain protected by the lease.
            const prefix = `${os.hostname()}:`;
            const pid = current.owner.startsWith(prefix) ? Number(current.owner.slice(prefix.length)) : 0;
            if (!pid || processAlive(pid)) return false;
        }
        await KV.upsert({key: LEASE, value: JSON.stringify({owner, expiresAt: now + leaseMs})}, {transaction: tx});
        return true;
    });
}
export async function renewLease() {
    const row: any = await KV.findOne({where: {key: LEASE}});
    let current: any = {};
    try { current = row?.value ? JSON.parse(row.value) : {}; } catch (_) {}
    if (current.owner !== owner) return false;
    await KV.upsert({key: LEASE, value: JSON.stringify({owner, expiresAt: Date.now() + leaseMs})});
    return true;
}
export async function releaseLease() {
    const row: any = await KV.findOne({where: {key: LEASE}});
    let current: any = {};
    try { current = row?.value ? JSON.parse(row.value) : {}; } catch (_) {}
    if (current.owner === owner) await KV.upsert({key: LEASE, value: ''});
}
