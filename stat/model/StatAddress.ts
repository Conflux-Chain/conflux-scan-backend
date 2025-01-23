import {QueryTypes, DataTypes, Model, Op} from "sequelize";
import {FullTransaction} from "./FullBlock";
import {Erc20Transfer, T_ERC20_TRANSFER} from "./Erc20Transfer";
import {getEpochRange} from "./Utils";
import {T_ERC721_TRANSFER} from "./Erc721Transfer";
import {T_ERC1155_TRANSFER} from "./Erc1155Transfer";

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
    calcDailyActiveAddress(new Date()).catch(e=>{
        console.log(`${__filename} calc Daily Active Address:`, e)
    })
    setTimeout(scheduleDailyActiveAddress,3600*1000) // 1h
}
export async function calcDailyActiveAddress(dt:Date) {
    dt.setHours(0,0,0,0)
    let end = new Date(dt)
    end.setHours(23,59,59,999)
    const [epS, epE] = await getEpochRange(dt, end, false)
    /*let count = await FullTransaction.count({  distinct: true, col: 'fromId',      where:{
            createdAt: {[Op.between]:[dt, end]}
        }    })*/
    const sql = `SELECT COUNT(*) AS uniqueAddrCount FROM (
        select fromId from ${T_ERC20_TRANSFER} where epoch >= ? and epoch <= ? union
        select toId from ${T_ERC20_TRANSFER} where epoch >= ? and epoch <= ? union
        select fromId from ${T_ERC721_TRANSFER} where epoch >= ? and epoch <= ? union
        select toId from ${T_ERC721_TRANSFER} where epoch >= ? and epoch <= ? union
        select fromId from ${T_ERC1155_TRANSFER} where epoch >= ? and epoch <= ? union
        select toId from ${T_ERC1155_TRANSFER} where epoch >= ? and epoch <= ? union
        select fromId from ${FullTransaction.getTableName()}  where epoch >= ? and epoch <= ? union
        select toId from ${FullTransaction.getTableName()}  where epoch >= ? and epoch <= ?                                    
    ) t`;
    const result = await Erc20Transfer.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: [epS, epE, epS, epE, epS, epE, epS, epE, epS, epE, epS, epE, epS, epE, epS, epE],
        raw: true,
    });
    const count = result[0]['uniqueAddrCount'];
    // expect that record exists
    await DailyActiveAddress.bulkCreate([{day:dt, cnt: count}], {updateOnDuplicate: ['cnt']})
}
