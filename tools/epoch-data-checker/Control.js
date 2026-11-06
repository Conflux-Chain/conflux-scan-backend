"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.releaseLease = exports.renewLease = exports.acquireLease = exports.leaseOwner = exports.isEnabled = exports.setEnabled = exports.LAST_ERROR = exports.LEASE = exports.ENABLED = void 0;
const os = require("os");
const KV_1 = require("../../stat/model/KV");
exports.ENABLED = 'DATA_CHECK_ENABLED';
exports.LEASE = 'DATA_CHECK_LEASE';
exports.LAST_ERROR = 'DATA_CHECK_LAST_ERROR';
const owner = `${os.hostname()}:${process.pid}`;
const leaseMs = 30000;
async function setEnabled(value) {
    await KV_1.KV.upsert({ key: exports.ENABLED, value: value ? 'true' : 'false' });
}
exports.setEnabled = setEnabled;
async function isEnabled() { return KV_1.KV.getSwitch(exports.ENABLED); }
exports.isEnabled = isEnabled;
async function leaseOwner() {
    return KV_1.KV.getString(exports.LEASE, '');
}
exports.leaseOwner = leaseOwner;
async function acquireLease() {
    const sequelize = KV_1.KV.sequelize;
    return sequelize.transaction(async (tx) => {
        const row = await KV_1.KV.findOne({ where: { key: exports.LEASE }, transaction: tx, lock: tx.LOCK.UPDATE });
        const now = Date.now();
        let current = {};
        try {
            current = row?.value ? JSON.parse(row.value) : {};
        }
        catch (_) { }
        if (current.owner && current.owner !== owner && Number(current.expiresAt) > now)
            return false;
        await KV_1.KV.upsert({ key: exports.LEASE, value: JSON.stringify({ owner, expiresAt: now + leaseMs }) }, { transaction: tx });
        return true;
    });
}
exports.acquireLease = acquireLease;
async function renewLease() {
    const row = await KV_1.KV.findOne({ where: { key: exports.LEASE } });
    let current = {};
    try {
        current = row?.value ? JSON.parse(row.value) : {};
    }
    catch (_) { }
    if (current.owner !== owner)
        return false;
    await KV_1.KV.upsert({ key: exports.LEASE, value: JSON.stringify({ owner, expiresAt: Date.now() + leaseMs }) });
    return true;
}
exports.renewLease = renewLease;
async function releaseLease() {
    const row = await KV_1.KV.findOne({ where: { key: exports.LEASE } });
    let current = {};
    try {
        current = row?.value ? JSON.parse(row.value) : {};
    }
    catch (_) { }
    if (current.owner === owner)
        await KV_1.KV.upsert({ key: exports.LEASE, value: '' });
}
exports.releaseLease = releaseLease;
