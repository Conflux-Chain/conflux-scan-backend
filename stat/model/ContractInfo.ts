import {DataTypes, Model, Op, QueryTypes, Sequelize} from "sequelize";
import {initCfxSdk} from "../service/common/utils";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";

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
            sequelize: seq, tableName: 'abi_stub',
            indexes:[
                {name: 'idx_type_hash', unique:false, fields:[{name:'type'},{name:'hash'}]},
                {name: 'idx_type_name', unique:true, fields:[{name:'type'},{name:'fullName'}]},
            ]
        })
    }
}

export interface IContractABI {
    id?:number;
    contractId:number;
    abiId: number;
    updatedAt?:Date;
}
export class ContractABI extends Model<IContractABI> implements IContractABI {
    id?:number;
    contractId:number;
    abiId: number;
    updatedAt?:Date;
    static register(seq: Sequelize) {
        ContractABI.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey:true, autoIncrement: true},
            contractId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            abiId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            updatedAt: {type: DataTypes.DATE, allowNull: false, defaultValue: Date.now()},
        }, {
            sequelize: seq, tableName: 'contract_abi',
            indexes: [{
                name: 'idx_cid', fields:['contractId', 'abiId'], unique:true,
            }],
        })
    }
}
// Refer:
// https://docs.soliditylang.org/en/v0.5.3/abi-spec.html
// https://docs.soliditylang.org/en/v0.5.3/abi-spec.html#events
export async function saveAbiInfo(abiObj:any, contractId?:number) {
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
        console.log(`saved abi info: ${arr.length}`);
        const relationArr = contractId ? arr.map(info=>({
            contractId, abiId: info.id,
        } as IContractABI)) : [];
        return ContractABI.bulkCreate(relationArr, {
            updateOnDuplicate: ['updatedAt'],
        })
    }).catch(err=>{
        safeAddErrorLog('DB',`bulk-create-abi-info`, err);
        console.log(`bulk create abi info fail:`, err)
    })
}
async function queryContractMethods(toIdSet: Set<number>) {
    const toIdStr = [...toIdSet].join(',');
    const sql = ` select c.contractId, abi.* from (
    select * from ${ContractABI.getTableName()} WHERE contractId in [${toIdStr}]
    ) c
    left join ${AbiInfo.getTableName()} abi on c.abiId = abi.id and abi.type='function'`;
    const list = await AbiInfo.sequelize.query(sql, {type: QueryTypes.SELECT, raw: true})
        .then(res=> res as unknown as (AbiInfo & ContractABI)[])
        .catch(error=>{
            console.log(`failed to query contract abi \n ${sql} \n ${error.message}`);
            return []
        });

    const map = new Map<number, Map<string, AbiInfo>>();
    list.forEach(info=>{
        let subM = map.get(info.contractId);
        if (!subM) {
            subM = new Map();
            map.set(info.contractId, subM);
        }
        subM.set(info.hash, info);
    })
    return map;
}
export async function fillMethodInfo(list:{method?:string}[],
                                     toIdArr: number[],
                                     isOpenApi: boolean = false) {
    const toIdSet = new Set<number>(toIdArr);
    toIdSet.delete(0); // remove placeholder
    if (list.length === 0) {
        return;
    }

    // find abi of verified contracts
    const verifiedAbiMap = await queryContractMethods(toIdSet);

    // build pure abi map
    const poorAbiMap = new Map<string, AbiInfo>()
    list.map(row=>row.method).filter(methodId=>{
        return Boolean(methodId)
    }).forEach(methodId=>{
        poorAbiMap.set(methodId, null)
    })
    await AbiInfo.findAll({where:{hash:{[Op.in]:[...poorAbiMap.keys()], type: 'function',}},
        raw: true,
        // , logging: console.log
    }).then(list=>{
        list.forEach(info=>{
            if (poorAbiMap.has(info.hash)) {
                // we have multiple abi. set it to null, display method id instead.
                poorAbiMap.set(info.hash, null);
            } else {
                poorAbiMap.set(info.hash, info)
            }
        })
    }).catch(err=>{
        console.log(`build method map fail:`, err)
    })
    list.forEach((row, index)=>{
        const verifiedContractAbi = verifiedAbiMap.get(toIdArr[index]);
        const verifiedAbi = verifiedContractAbi?.get(row.method)?.fullName;
        // use verified abi prior to pure abi.
        const useMethod =  verifiedAbi || poorAbiMap.get(row.method)?.fullName;
        if(isOpenApi){
            row['methodId'] = row.method
            if(useMethod) {
                row.method = useMethod
            } else {
                delete row.method
            }
        } else{
            row.method = useMethod || row.method
        }
        // console.log(`set full name ${fullName} to ${row.method} , map v ${map.get(row.method)}`)
    })
}
