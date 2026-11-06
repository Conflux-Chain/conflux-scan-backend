import * as os from 'os';
import {QueryTypes} from 'sequelize';
import {KV} from '../../stat/model/KV';

export const ENABLED = 'DATA_CHECK_ENABLED';
export const LEASE = 'DATA_CHECK_LEASE';
const owner = `${os.hostname()}:${process.pid}`;
const leaseMs = 30_000;

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
        if (current.owner && current.owner !== owner && Number(current.expiresAt) > now) return false;
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
