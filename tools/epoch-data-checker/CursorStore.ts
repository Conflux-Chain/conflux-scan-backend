import {KV} from '../../stat/model/KV';

export const FORWARD = 'DATA_CHECK_FORWARD_EPOCH';
export const BACKWARD = 'DATA_CHECK_BACKWARD_EPOCH';
export const PAUSED_FORWARD = 'DATA_CHECK_FORWARD_PAUSED';
export const PAUSED_BACKWARD = 'DATA_CHECK_BACKWARD_PAUSED';

export class CursorStore {
    async get(direction: 'forward'|'backward'): Promise<number|null> {
        const key = direction === 'forward' ? FORWARD : BACKWARD;
        const value = await KV.getNumber(key, null);
        return value === null || Number.isNaN(value) ? null : value;
    }
    async set(direction: 'forward'|'backward', epoch: number) {
        await KV.saveNumber(direction === 'forward' ? FORWARD : BACKWARD, epoch);
    }
    async paused(direction: 'forward'|'backward'): Promise<boolean> {
        return KV.getSwitch(direction === 'forward' ? PAUSED_FORWARD : PAUSED_BACKWARD);
    }
    async pause(direction: 'forward'|'backward') {
        await KV.upsert({key: direction === 'forward' ? PAUSED_FORWARD : PAUSED_BACKWARD, value: 'true'});
    }
    async resume(direction: 'forward'|'backward') {
        await KV.upsert({key: direction === 'forward' ? PAUSED_FORWARD : PAUSED_BACKWARD, value: 'false'});
    }
}
