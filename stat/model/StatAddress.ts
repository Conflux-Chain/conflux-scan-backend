import {QueryTypes, DataTypes, Model} from "sequelize";

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