import {QueryTypes, DataTypes, Model, Op} from "sequelize";
import {FullTransaction} from "./FullBlock";

export interface IAddressStat {
    id?:number
    day:Date
    cnt:number
}
export const T_ADDRESS_STAT = 'daily_addr'
export class AddressStat extends Model<IAddressStat> implements IAddressStat {
    id?:number
    day:Date
    cnt:number
    static register(seq) {
        AddressStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
            day: {type: DataTypes.DATEONLY, allowNull: false, unique: true},
            cnt: {type: DataTypes.BIGINT, allowNull: false},
        }, {
            sequelize: seq,
            tableName: T_ADDRESS_STAT,
        })
    }
}
export async function incDailyAddressCount(dt:Date, cnt:number) {
    const sql = `insert into ${T_ADDRESS_STAT} (day,cnt,createdAt,updatedAt) values (?,?, now(),now())
       on duplicate key update cnt = cnt + ?, updatedAt = now()`;
    return AddressStat.sequelize.query(sql,{
        type: QueryTypes.UPDATE,
        replacements:[dt, cnt, cnt],
        // logging: console.info
    })
}
export const T_DAILY_ACTIVE_ADDRESS = 'daily_active_addr'
export interface IDailyActiveAddress {
    day:Date
    cnt:number
}
export class DailyActiveAddress extends Model<IDailyActiveAddress> implements IDailyActiveAddress {
    day:Date
    cnt:number
    static register(seq) {
        DailyActiveAddress.init({
            day: {type: DataTypes.DATEONLY, allowNull: false, primaryKey: true, },
            cnt: {type: DataTypes.BIGINT, allowNull: false},
        },{
            sequelize: seq,
            tableName: T_DAILY_ACTIVE_ADDRESS
        })
    }
}
export async function scheduleDailyActiveAddress() {
    calcDailyActiveAddress(new Date()).then()
    setTimeout(scheduleDailyActiveAddress,3600*1000) // 1h
}
export async function calcDailyActiveAddress(dt:Date) {
    dt.setHours(0,0,0,0)
    let end = new Date(dt)
    end.setHours(23,59,59,999)
    let count = await FullTransaction.count({        where:{
            createdAt: {[Op.between]:[dt, end]}
        }    })
    // expect that record exists
    const [updatedRows] = await DailyActiveAddress.update({cnt: count},{
        where: {day: dt}
    })
    if (updatedRows === 0) {
        await DailyActiveAddress.create({day:dt, cnt: count})
    }
}