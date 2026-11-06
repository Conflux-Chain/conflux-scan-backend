"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CursorStore = exports.PAUSED_BACKWARD = exports.PAUSED_FORWARD = exports.BACKWARD = exports.FORWARD = void 0;
const KV_1 = require("../../stat/model/KV");
exports.FORWARD = 'DATA_CHECK_FORWARD_EPOCH';
exports.BACKWARD = 'DATA_CHECK_BACKWARD_EPOCH';
exports.PAUSED_FORWARD = 'DATA_CHECK_FORWARD_PAUSED';
exports.PAUSED_BACKWARD = 'DATA_CHECK_BACKWARD_PAUSED';
class CursorStore {
    async get(direction) {
        const key = direction === 'forward' ? exports.FORWARD : exports.BACKWARD;
        const value = await KV_1.KV.getNumber(key, null);
        return value === null || Number.isNaN(value) ? null : value;
    }
    async set(direction, epoch) {
        await KV_1.KV.saveNumber(direction === 'forward' ? exports.FORWARD : exports.BACKWARD, epoch);
    }
    async paused(direction) {
        return KV_1.KV.getSwitch(direction === 'forward' ? exports.PAUSED_FORWARD : exports.PAUSED_BACKWARD);
    }
    async pause(direction) {
        await KV_1.KV.upsert({ key: direction === 'forward' ? exports.PAUSED_FORWARD : exports.PAUSED_BACKWARD, value: 'true' });
    }
    async resume(direction) {
        await KV_1.KV.upsert({ key: direction === 'forward' ? exports.PAUSED_FORWARD : exports.PAUSED_BACKWARD, value: 'false' });
    }
}
exports.CursorStore = CursorStore;
