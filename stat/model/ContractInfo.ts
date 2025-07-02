import {DataTypes, Model, Op, QueryTypes, Sequelize} from "sequelize";
import {initCfxSdk} from "../service/common/utils";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {ContractVerify} from "./ContractVerify";
import {format} from "js-conflux-sdk";
import {StatApp} from "../StatApp";
import {getAddrId, } from "./HexMap";
import {Interface, keccak256} from "ethers/lib/utils";
import {Errors} from "../service/common/LogicError";
import {ContractImpl} from "./ContractImpl";
import {getContractQuery} from "../service/ContractQuery";

export interface IAbiInfo {
    id?:number
    hash:string
    type:string
    fullName:string
    formatWithArg?: string
    updatedAt?:Date
}
export const FormatWithArgMaxLength = 4096;
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
            formatWithArg: {type: DataTypes.STRING(FormatWithArgMaxLength), allowNull: false, defaultValue: ''},
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
let UPDATE_FIELDS_FOR_DUPLICATE_ABI: (keyof IAbiInfo)[] = ['updatedAt'];
export function setFieldsForUpdate(v: (keyof IAbiInfo)[]) {
    UPDATE_FIELDS_FOR_DUPLICATE_ABI = v;
}
// Refer:
// https://docs.soliditylang.org/en/v0.5.3/abi-spec.html
// https://docs.soliditylang.org/en/v0.5.3/abi-spec.html#events
export async function saveAbiInfo(abiObj:any, contractId?:number, dryRun = false) {
    const abi = (typeof abiObj === 'string') ? JSON.parse(abiObj) : abiObj;
    let iFace: Interface;
    try {
        iFace = new Interface(abi);
    } catch (e) {
        console.log(`failed to parse abi, contract id `, contractId, `abi`, abi, 'error is ', e);
        if (dryRun) {
            throw e;
        }
        return e.message?.includes('can not found matched coder');
    }

    const arr:IAbiInfo[] = [];
    // each key is a prop of the contract, only care the exact method/event like abc(address,uint)
    const maxFullName = 1024;
    const fnAndEvents = [...Object.keys(iFace.events), ...Object.keys(iFace.functions)];
    for (let key of fnAndEvents) {
        const field = iFace.events[key] || iFace.functions[key];
        if (!field) {
            continue;
        }
        const fullFormat = field.format('full');
        if (dryRun) {
            // check name
            for (const param of field.inputs) {
                if (!param.name) {
                    throw new Errors.ParameterError(`parameter name is empty: ${fullFormat}`);
                }
            }
        }
        if (fullFormat.length > FormatWithArgMaxLength) {
            console.log(`skip entry exceeds max length , full format ${fullFormat.length} > ${FormatWithArgMaxLength} \n`, fullFormat);
            continue;
        }
        // console.log(`---- ${key} : ${typeof field} `, fullFormat);
        const type = field.type;
        let useName = key;
        let sig = '';
        if (field.type === 'event') {
            sig = keccak256(Buffer.from(key))
        } else {
            sig = iFace.getSighash(field);
        }
        if (useName.length > maxFullName) {
            console.log(`skip entry exceeds max length , full name ${useName.length} > ${maxFullName} \n`, useName);
            continue;
        }
        const template = {fullName: useName, hash: sig, type, formatWithArg: fullFormat};
        arr.push(template)
    }
    if (dryRun) {
        console.log(`abi beans are:`, arr);
        return true;
    }
    return AbiInfo.bulkCreate(arr, {
        updateOnDuplicate: UPDATE_FIELDS_FOR_DUPLICATE_ABI,
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
        where: {verifyResult: true, base32: ref.base32},
        raw: true
    });
    if (!proxyC) {
        return;
    }
    const implInfo = await ContractImpl.findOne({
        where: {cid: ref.contractId}, raw: true,
    })
    if (!implInfo) {
        getContractQuery().queryImplementation(ref.base32).then(async res=>{
            const {proxy, implementation} = res || {};
            const implId = await getAddrId(implementation);
            await ContractImpl.bulkCreate([{
                cid: ref.contractId, implId: implId, proxyType: '',
            }], {
                updateOnDuplicate: ['implId', 'updatedAt'],
            })
        }).catch(err=>{
            console.log(`failed to cache contract implementation, contract ${ref.base32} `, err);
        })
        return; //
    }
    if (!implInfo.implId) {
        return;
    }
    const implId = implInfo.implId;
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
    const dupAbiMap = new Map<string, number>();
    await AbiInfo.findAll({
        where:{
            hash:{[Op.in]:[...poorAbiMap.keys()]},
            type: 'function',
        },
        raw: true,
        // , logging: console.log
    }).then(list=>{
        poorAbiMap.clear();
        list.forEach(info=>{
            if (dupAbiMap.has(info.hash)) {
                // nothing, do not use it
            } else if (poorAbiMap.has(info.hash)) {
                // we have multiple abi. mark.
                dupAbiMap.set(info.hash, 2);
                // remove
                poorAbiMap.delete(info.hash);
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

export function parseAbiStr(str: string) {
        const jsonArr = JSON.parse(str);
        const iFace = new Interface(jsonArr);
        return iFace.format();
}

export async function saveAbiAnnounce(str: string, epoch:number) {
    let segments: string | Array<string>;
    try {
        segments = parseAbiStr(str);
    } catch (e) {
        console.log(`failed to parse abi at epoch ${epoch} for ${str}`, e);
        throw e;
    }
    return saveAbiInfo(segments);
}
