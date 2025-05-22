import {DataTypes, Model, Op, QueryTypes, Sequelize} from "sequelize";
import {initCfxSdk} from "../service/common/utils";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {ContractVerify} from "./ContractVerify";
import {format} from "js-conflux-sdk";
import {StatApp} from "../StatApp";
import {getAddrId, } from "./HexMap";

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
            sequelize: seq, tableName: 'abi_stub', charset: 'ascii', collate: 'ascii_general_ci',
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
            updatedAt: {type: DataTypes.DATE, allowNull: false},
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
    let contract: any;
    try {
        contract = cfx.Contract({abi});
    } catch (e) {
        console.log(`failed to parse abi, contract id `, contractId, `abi`, abi, 'error is ', e);
        return e.message?.includes('can not found matched coder'); // js conflux sdk
    }
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
        if (contractId) {
            return saveContractAbiRef(arr, contractId);
        }
    }).then(()=>{
        return true;
    }).catch(err=>{
        safeAddErrorLog('DB',`bulk-create-abi-info`, err);
        console.log(`bulk create abi info fail:`, err)
        return false;
    })
}
async function saveContractAbiRef(arr: AbiInfo[], contractId: number) {
    return Promise.all(arr.map(async info => {
        const res = await AbiInfo.findOne({
            where: {type: info.type, fullName: info.fullName}
        });
        if (res) {
            return ContractABI.upsert({
                contractId, abiId: res.id,
            });
        } else {
            console.log(`DB: abi not found for `, info);
        }
    }))
}
async function queryContractMethods(toIdSet: Iterable<number>) {
    const toIdStr = [...toIdSet].join(',');
    const sql = ` select c.contractId, abi.* from (
    select * from ${ContractABI.getTableName()} WHERE contractId in (${toIdStr})
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
async function mergeVerifiedImplAbi(ref: IContractImplAbiRef) {
    const proxyC = await ContractVerify.findOne({
        attributes: ['base32', 'implementation'],
        where: {verifyResult: true, base32: ref.base32, proxy: true},
        raw: true
    });
    if (! proxyC?.implementation) {
        return;
    }
    const implId = await getAddrId(proxyC.implementation);
    const map = await queryContractMethods([implId])
    ref.implBase32 = proxyC.implementation;
    ref.implAbiMap = map.get(implId);
    ref.implId = implId;
}
interface IContractImplAbiRef {
    contractId: number;
    base32?: string;
    implBase32?: string;
    implId?: number;
    implAbiMap?: Map<string, AbiInfo>;
}
export async function fillMethodInfo(list:{method?:string, to?:string}[],
                                     toIdArr: number[],
                                     isOpenApi: boolean = false) {
    const toIdSet = new Set<number>(toIdArr);
    toIdSet.delete(0); // remove placeholder
    if (toIdSet.size === 0) {
        return;
    }
    const cImplAbiMap = new Map<number, IContractImplAbiRef>();
    const taskArr = [];
    list.forEach((row, idx)=>{
        if (row.to) {
            const toId = toIdArr[idx];
            const toBase32 = row.to.startsWith('0x') ? format.address(row.to, StatApp.networkId, false) : row.to;
            let ref = cImplAbiMap.get(toId);
            if (!ref) {
                ref = {contractId: toId, base32: toBase32};
                cImplAbiMap.set(toId, ref);
                taskArr.push(mergeVerifiedImplAbi(ref));
            }
        }
    })
    await Promise.all(taskArr).catch(err=>{
        console.log(`failed to fetch impl methodInfo:`, err);
    });

    // find abi of verified contracts
    const verifiedAbiMap = await queryContractMethods(toIdSet);

    // build pure abi map
    const poorAbiMap = new Map<string, AbiInfo>()
    list.map(row=>row.method).filter(methodId=>{
        return Boolean(methodId)
    }).forEach(methodId=>{
        poorAbiMap.set(methodId, null)
    })
    await AbiInfo.findAll({
        where:{
            hash:{[Op.in]:[...poorAbiMap.keys()]},
            type: 'function',
        },
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
        const toId = toIdArr[index];
        const verifiedContractAbi = verifiedAbiMap.get(toId)?.get(row.method)?.fullName;
        const verifiedImplAbi = cImplAbiMap.get(toId)?.implAbiMap?.get(row.method)?.fullName;
        // use verified abi prior to pure abi.
        const useMethod =  verifiedContractAbi || verifiedImplAbi || poorAbiMap.get(row.method)?.fullName;
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
