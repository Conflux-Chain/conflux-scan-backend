import {Op,Sequelize, DataTypes, Model, QueryTypes} from "sequelize";
import {makeId} from "./HexMap";
import {Conflux} from "js-conflux-sdk";
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

export interface IAbiInfo {
    id?:number
    hash:string
    type:string
    fullName:string
    updatedAt?:Date
}
export class AbiInfo extends Model<IAbiInfo> implements IAbiInfo {
    id?:number
    hash:string
    type:string
    fullName:string
    updatedAt?:Date
    static register(seq) {
        AbiInfo.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey:true, autoIncrement: true},
            hash: {type: DataTypes.STRING(66), allowNull: false, defaultValue: ''},
            type: {type: DataTypes.STRING(16), allowNull: false, defaultValue: ''},
            fullName: {type: DataTypes.STRING(1024), allowNull: false, defaultValue: ''},
        }, {
            sequelize: seq, tableName: 'abi_info',
            indexes:[
                {name: 'idx_sig', unique:true, fields:[{name:'hash'},{name:'type'}]}
            ]
        })
    }
}
// Refer:
// https://docs.soliditylang.org/en/v0.5.3/abi-spec.html
// https://docs.soliditylang.org/en/v0.5.3/abi-spec.html#events
export async function saveAbiInfo(abi:any) {
    const cfx = new Conflux({url:''})
    const contract = cfx.Contract({abi})
    const arr:IAbiInfo[] = []
    // each key is a prop of the contract, only care the exact method/event like abc(address,uint)
    const maxFullName = 1024
    for (let key of Object.keys(contract)) {
        const field = contract[key]
        if (key.includes('(')) {
            // console.log(`${key} : ${typeof field} ${Object.keys(field).join(',')}, ${field.signature}`)
            const template = {fullName: key.substr(0, maxFullName), hash: field.signature, type: "function"}
            if (field.signature.length === 66/*keccak hash*/) {
                // event
                template.type = "event"
            }
            arr.push(template)
        }
    }
    AbiInfo.bulkCreate(arr, {
        updateOnDuplicate:['updatedAt']
    }).then(arr=>{
        console.log(`save abi info: ${arr.length}`)
    }).catch(err=>{
        console.log(`bulk create abi info fail:`, err)
    })
}
export async function fillMethodInfo(arr:{method?:string}[]) {
    if (arr.length === 0) {
        return;
    }
    const map = new Map<string, AbiInfo>()
    arr.map(row=>row.method).filter(row=>{
        return Boolean(row)
    }).forEach(row=>{
        map.set(row, null)
    })
    await AbiInfo.findAll({where:{hash:{[Op.in]:[...map.keys()]}}
        // , logging: console.log
    }).then(list=>{
        list.forEach(info=>map.set(info.hash, info))
    }).catch(err=>{
        console.log(`build method map fail:`, err)
    })
    arr.forEach(row=>{
        let fullName = map.get(row.method)?.fullName || row.method;
        row.method = fullName
        // console.log(`set full name ${fullName} to ${row.method} , map v ${map.get(row.method)}`)
    })
}