import {DataTypes, Model, Transaction, Sequelize, UniqueConstraintError} from "sequelize";

export interface IHeartBeatBean {
    key: string; updatedAt: Date;
}

export class HeartBeatBean extends Model<IHeartBeatBean> implements IHeartBeatBean {
    key: string; updatedAt: Date;
    static register(sequelize:Sequelize) {
        HeartBeatBean.init({
            key: {type: DataTypes.CHAR(64), primaryKey: true},
            updatedAt: {type: DataTypes.DATE},
        }, {
            sequelize,
            tableName: "heart_beat",
            createdAt: false,
        });
    }
}

export const KEY_COMPILER = "compiler_container"
export const KEY_SCAN_API = "scan_api_container"
export const KEY_STAT = "stat_container"
export const KEY_OPEN_API = "open_api_container"

// each app tracks its own last time
let lastTime = 0
const minTimeSpan = 30_000

export function repeatHeartBeat(key: string) {
    setInterval(()=>doHeartBeat(key), 10_000)
}

export async function doHeartBeat(key:string) {
    const now = Date.now();
    if (now - lastTime < minTimeSpan) {
        return
    }
    return HeartBeatBean.upsert({key, updatedAt: new Date()}).then(res=>{
        lastTime = now;
        return res
    })
}
