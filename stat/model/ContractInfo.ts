import {Op, DataTypes, Model, QueryTypes} from "sequelize";
import {initCfxSdk} from "../service/common/utils";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";

const T_CONTRACT_INFO = 'contract_info'


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
export async function saveAbiInfo(abiObj:any) {
    const abi = (typeof abiObj === 'string') ? JSON.parse(abiObj) : abiObj;
    const cfx = await initCfxSdk({url:''});
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
    return AbiInfo.bulkCreate(arr, {
        updateOnDuplicate:['updatedAt']
    }).then(arr=>{
        console.log(`save abi info: ${arr.length}`)
    }).catch(err=>{
        safeAddErrorLog('DB',`bulk-create-abi-info`, err);
        console.log(`bulk create abi info fail:`, err)
    })
}
export async function fillMethodInfo(arr:{method?:string}[], isOpenApi: boolean = false) {
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
        if(isOpenApi){
            row['methodId'] = row.method
            if(map.get(row.method)?.fullName) {
                row.method = map.get(row.method).fullName
            } else {
                delete row.method
            }
        } else{
            let fullName = map.get(row.method)?.fullName || row.method;
            row.method = fullName
        }
        // console.log(`set full name ${fullName} to ${row.method} , map v ${map.get(row.method)}`)
    })
}
