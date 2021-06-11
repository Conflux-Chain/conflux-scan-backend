import {Sequelize, DataTypes, Model, Transaction, Op} from "sequelize";

export interface ILock {
    id:number
    lockKey:string
    ms:number
    remark:string
}
// prefix with epoch to build a key
export const PATTERN_MAKE_HASH_ID = '_EPOCH_HASH'
export class Lock extends Model<ILock> implements ILock {
    id:number
    lockKey:string
    ms:number
    remark:string
    static register(seq:Sequelize) {
        Lock.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
            lockKey: {type: DataTypes.CHAR(40), allowNull: false, unique: true},
            ms: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            remark: {type: DataTypes.CHAR(128), allowNull: false, defaultValue: ''},
        }, {
            sequelize: seq,
            tableName: 'lock',
            timestamps: false,
            createdAt: true,
        })
    }
}
export async function delLock(key) {
    return Lock.destroy({where: {lockKey: key}})
}
export async function waitLock(key:string, remark:string = '') : Promise<boolean> {
    let tryTimes = 0
    do {
        const [bean, created] = await Lock.upsert({id:null, lockKey: key, ms: Date.now(), remark},{
            fields: ['lockKey']
        })
        if (created) {
            return true
        }
        tryTimes ++
        if (tryTimes % 100 === 0) {
            console.log(`${new Date().toISOString()} still trying to acquire lock ${key
            }, ${remark}, times ${tryTimes} .`)
        }
        if (tryTimes >= 500) { // 10s
            console.log(`${new Date().toISOString()}, acquire lock fail, ${key} times ${tryTimes}.`)
            return false;
        }
        await new Promise(r=>setTimeout(r, 20))
    } while (true)
}