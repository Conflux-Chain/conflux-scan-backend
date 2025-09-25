import {DataTypes, Model, Transaction, Sequelize, UniqueConstraintError} from "sequelize";

export interface IHeartBeatBean {
    key: string; updatedAt: Date;
}

export class HeartBeatBean extends Model<IHeartBeatBean> implements IHeartBeatBean {
    key: string; updatedAt: Date;
    static register(sequelize:Sequelize) {
        HeartBeatBean.init({
            key: {type: DataTypes.CHAR(128), primaryKey: true},
            updatedAt: {type: DataTypes.DATE},
        }, {
            sequelize,
            tableName: "heart_beat",
            createdAt: false,
        });
    }
}

export const KEY_COMPILER = "HB_compiler"
export const KEY_SCAN_API = "HB_scan_api"
export const KEY_STAT = "HB_stat"
export const KEY_OPEN_API = "HB_open_api"
export const KEY_1155_SYNC = "HB_sync1155"
export const KEY_TRANSFER_COUNT = "HB_transfer_count"
export const KEY_CONTRACT_USER = "HB_contract_user"
export const KEY_PRUNE = "HB_prune"
export const KEY_STAT_TASK = "HB_stat_task"

// each app tracks its own last time
const lastTimeMap = new Map<string, number>()
const minTimeSpan = 30_000

export function repeatHeartBeat(key: string) {
    setInterval(()=>doHeartBeat(key), 10_000)
}

export async function doHeartBeat(key:string) {
    if (!HeartBeatBean.sequelize) {
        console.log(`${__filename} sequelize is absent`)
        return
    }
    const lastTime = lastTimeMap.get(key) || 0;
    const now = Date.now();
    if (now - lastTime < minTimeSpan) {
        return
    }
    return HeartBeatBean.upsert({key, updatedAt: new Date()}).then(res=>{
        lastTimeMap.set(key, now)
        return res
    }).catch(err=>{
        console.log(`${__filename} failed to upsert heart beat.`, err);
    })
}
