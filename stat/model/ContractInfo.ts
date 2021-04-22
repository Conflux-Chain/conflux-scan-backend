import {Sequelize, DataTypes, Model} from "sequelize";
import {makeId} from "./HexMap";
import {StatApp} from "../StatApp";
import {TxnQuery} from "../service/TxnQuery";
import {Erc20Transfer} from "./Erc20Transfer";
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
                    {name:'epoch', order:'DESC'},
                    {name:'hexId', order:'DESC'},
                    ], unique: true}
            ]
        })
    }
}

export async function batchSaveContractInfo(array: {name:string, hex40:string, epoch:number}[], seconds) {
    let templates:IContractInfo[] = []
    let date = new Date(Number(seconds)*1000)
    for (const obj of array) {
        // hex address should exists already.
        const hexId = (await makeId(obj.hex40, undefined, {dt:date})).id
        const base32 = TxnQuery.base32(obj.hex40, StatApp.networkId)
        templates.push({id: 0, base32, name:obj.name, epoch:obj.epoch, hexId})
    }
    return ContractInfo.bulkCreate(templates,{
        logging: console.log
    }).catch(err=>{
        console.log(`ContractInfo.bulkCreate fail:`, err)
        throw err
    })
}
export async function batchPopContractInfo(epoch) {
    return ContractInfo.destroy({
        where: {
            epoch: epoch
        },
//         logging:console.log
    })
}