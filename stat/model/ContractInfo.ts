import {Sequelize, DataTypes, Model, QueryTypes} from "sequelize";
import {makeId} from "./HexMap";
// import {StatApp} from "../StatApp";
// import {TxnQuery} from "../service/TxnQuery";
export interface IContractInfo {
    id?:number
    hexId?:number
    name:string
    base32:string
    epoch:number
}
export const T_CONTRACT_INFO = 'contract_info'
export class ContractInfo extends Model<IContractInfo> implements IContractInfo {
    id?:number
    hexId?:number
    name:string
    base32:string
    epoch:number
    static register(seq) {
        ContractInfo.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey:true, autoIncrement: true},
            hexId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            epoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            name: {type: DataTypes.STRING(128), allowNull: false, defaultValue: ''},
            base32: {type: DataTypes.STRING(64), allowNull: false, defaultValue: ''},
        },{
            sequelize: seq,
            tableName: T_CONTRACT_INFO,
            indexes: [
                {name: 'idx_epoch', fields:[
                    {name:'hexId', order:'DESC'},
                    {name:'epoch', order:'DESC'},
                    ]}
            ]
        })
    }
}
export async function listAllContract(): Promise<ContractInfo[]> {
    const maxEpochSql = `select max(epoch) as epoch, hexId from ${T_CONTRACT_INFO} group by hexId`
    const sql = `select main.* from ${T_CONTRACT_INFO} main join (${maxEpochSql
        }) maxT on main.hexId=maxT.hexId and main.epoch=maxT.epoch order by main.epoch desc`
    return ContractInfo.sequelize.query(sql, {type: QueryTypes.SELECT})
}

export async function batchPopContractInfo(epoch) {
    return ContractInfo.destroy({
        where: {
            epoch: epoch
        },
//         logging:console.log
    })
}