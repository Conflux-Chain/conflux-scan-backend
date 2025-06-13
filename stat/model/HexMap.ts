import {Sequelize, DataTypes, Model, Transaction, Op} from "sequelize";
import {incDailyAddressCount} from "./StatAddress";
import {delLock, waitLock} from "./Lock";
import {format} from "js-conflux-sdk";
import {StatApp} from "../StatApp";
import {Contract} from "./Contract";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
const NodeCache = require( "node-cache" );
const lodash = require('lodash');

export const CONTRACT_STAKING = '0x0888000000000000000000000000000000000002'
// use virtual contract address to make special transfer more readable.
export const VIRTUAL_STORAGE_COLLATERAL = '0x8f00000000000000000000000000000000000001'
export const VIRTUAL_SPONSOR_BALANCE_FOR_GAS = '0x8f00000000000000000000000000000000000002'
export const VIRTUAL_SPONSOR_BALANCE_FOR_COLLATERAL = '0x8f00000000000000000000000000000000000003'
export const VIRTUAL_GAS_PAYMENT = '0x8f00000000000000000000000000000000000004'
// https://developer.confluxnetwork.org/conflux-doc/docs/RPCs/trace_rpc#new-added-space-field
export const POCKET_ADDRESS_MAP = {
    'staking_balance': CONTRACT_STAKING,
    'storage_collateral': VIRTUAL_STORAGE_COLLATERAL,
    'sponsor_balance_for_gas': VIRTUAL_SPONSOR_BALANCE_FOR_GAS,
    'sponsor_balance_for_collateral': VIRTUAL_SPONSOR_BALANCE_FOR_COLLATERAL,
    'gas_payment': VIRTUAL_GAS_PAYMENT,
}
export function patchPocketAddress(pocket: string, address: string, net = undefined) {
    const v = POCKET_ADDRESS_MAP[pocket];
    if (v) {
        if (net !== undefined) {
            return formatToBase32(v)
        }
        return v;
    }
    return address;
}
export async function makeVirtualContractInfo(netId: number) {
    // console.log(`makeVirtualContractInfo`)
    for (let name of Object.keys(POCKET_ADDRESS_MAP)) {
        // console.log(`check ${name}`)
        const hex = POCKET_ADDRESS_MAP[name];
        let hexId = await getAddrId(hex)
        if (isNaN(hexId)) {
           hexId = await makeIdV(hex)
        }
        const contract = await Contract.findOne({where: {hex40id: hexId}})
        if (contract === null) {
            const base32 = formatToBase32(hex)
            await Contract.create({epoch: 0, name, hex40id: hexId, base32})
        }
    }
}

export interface HexMapAttributes {
    id?: number;
    hex: string
    createdAt?: Date
}

export class Hex40Map extends Model<HexMapAttributes> implements HexMapAttributes {
    public id?: number;
    public hex: string;
    createdAt?: Date
    static register(sequelize) {
    Hex40Map.init(
            {
                id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
                hex: {type: DataTypes.CHAR(40), allowNull: false,},
                createdAt: {type: DataTypes.DATE, allowNull: true,},
            },
            {
                tableName: 'hex40',
                sequelize: sequelize,
                timestamps: false, // prevent default columns: createdAt, updatedAt
                indexes: [
                    {
                        name: `hex40_index`,
                        fields: [{name: 'hex',}],
                        unique: true
                    }
                    // index `createdAt` will affect performance.
                    // implement stat by other table.
                ]
            }
        )
    }
}

export async function buildCrossAddr(space: string, addr: string, dt: Date, resultArr: ESpaceHexMapAttributes[]) {
    if (space !== 'evm') {
        return;
    }
    const {id, hex} = (await makeId(addr, undefined, {dt}));
    resultArr.push({hex, hexId: id, createdAt: dt});
}

export interface ESpaceHexMapAttributes {
    id?: number;
    hexId: number;
    hex: string
    createdAt?: Date
}
export class ESpaceHex40Map extends Model<ESpaceHexMapAttributes> implements ESpaceHexMapAttributes {
    public id?: number;
    public hexId: number;
    public hex: string;
    createdAt?: Date
    static register(sequelize) {
        ESpaceHex40Map.init(
            {
                id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
                hexId: {type: DataTypes.BIGINT, allowNull: false,},
                hex: {type: DataTypes.CHAR(40), allowNull: false,},
                createdAt: {type: DataTypes.DATE, allowNull: true,},
            },
            {
                tableName: 'e_space_hex40',
                sequelize: sequelize,
                timestamps: false, // prevent default columns: createdAt, updatedAt
                indexes: [
                    {
                        name: `index_hexId`,
                        fields: [{name: 'hexId',}],
                        unique: true
                    }
                ]
            }
        )
    }
}
const cacheTtl = 60 * 10 // 10 minutes
const base32toHexCache = new NodeCache({ maxKeys: 10000,  stdTTL: cacheTtl, checkperiod: 60})
export function formatToHex(address:string) : string {
    let hex = base32toHexCache.get(address)
    if (hex) {
        return hex;
    }
    hex = format.hexAddress(address);
    try {
        base32toHexCache.set(address, hex, cacheTtl)
    } catch (e){
        //error: Cache max keys amount exceeded
    }
    return hex;
}
const hexToBase32Cache = new NodeCache({ maxKeys: 10000,  stdTTL: cacheTtl, checkperiod: 60})
export function formatToBase32(address:string) {
    let base32 = hexToBase32Cache.get(address)
    if (base32) {
        return base32
    }
    base32 = format.address(address, StatApp.networkId)
    try {
        hexToBase32Cache.set(address, base32, cacheTtl)
    } catch (e){
        //error: Cache max keys amount exceeded
    }
    return base32
}
const dbCache = new NodeCache({ maxKeys: 10000,  stdTTL: cacheTtl, checkperiod: 60})
export async function makeIdV(hex: string, dbTxNotUsed: Transaction = undefined, p = undefined) : Promise<number>{
    return makeId(hex, undefined, p).then(res=>res.id)
}
// https://sequelize.org/master/class/lib/model.js~Model.html#static-method-findOrCreate
export async function makeId(hex: string, dbTxNotUsed: Transaction = undefined, {dt = undefined} = {}) {
    if (hex === '0x0' || hex === undefined || hex === null) {
        return {id:0};
    }
    if (hex.startsWith('0x')) {
        hex = hex.substr(2);
    } else if (hex.startsWith('CFX') || hex.startsWith('cfx') || hex.startsWith('net') || hex.startsWith('NET')) {
        hex = formatToHex(hex).substr(2)
    }
    let map = Hex40Map;
    const cached = dbCache.get(hex)
    if (cached !== undefined && cached !== null) {
        dbCache.ttl(hex, cacheTtl)
        return cached
    }
    const exists = await map.findOne({where:{hex}})
    if (exists) {
        try{
            dbCache.set(hex, exists, cacheTtl);
        } catch (e){
            //error: Cache max keys amount exceeded
        }
        return exists
    }
    const values:HexMapAttributes = {hex: hex};
    if (dt) values.createdAt = dt
    // console.log(`hex map for:`, values)
    let [bean, created] = await map.upsert(values, {
        fields:['hex'],
        // logging: console.log
    });
    if (created) {
        // hex40 has field createdAt
        if (dt && hex.length === 40) incDailyAddressCount(dt, 1).then().catch(e=>{
            safeAddErrorLog('sync',`increase-daily-address-count`, e);
        })
    } else {
        // exists already
        bean = await map.findOne({where:{hex}})
        if (bean === null) {
            console.log(` upsert not created, and find again returns null, hex ${hex}`)
            throw new Error(`How could it happen?`)
        }
    }
    try{
        dbCache.set(hex, bean, cacheTtl)
    } catch (e){
        //error: Cache max keys amount exceeded
    }
    // console.info(`created ${created}`)
    return bean;
}
export async function getAddrId(addr:string) {
    if (!addr) {
        return -1
    }
    if (addr.startsWith('0x')) {
    } else if (addr.startsWith('cfx') || addr.startsWith('net')){
        addr = formatToHex(addr)
    }
    return Hex40Map.findOne({
        where: {hex: addr.substr(2)}
    }).then(res=>{
        return res?.id
    })
}
export function buildHexSet<T>(hexSet:Set<T>, arr:any[], ...hexKey:string[]) : Set<T> {
    if (!hexSet) {
        hexSet = new Set<T>()
    }
    arr.forEach(bean=>{
        hexKey.forEach(k=>hexSet.add(bean[k]))
    });
    return hexSet
}
let debugLogCnt = 10
export async function buildIdMap(hexSet:Set<any>, model:typeof Hex40Map, biz:string, dt:Date) : Promise<Map<string,number>> {
    const templates = []
    hexSet.forEach(hex=>{
        templates.push({hex: hex.substr(2)})
    })
    let lockKey = 'batchBuildId'; // isolate lock by epoch ?
    const lockOk = await waitLock(lockKey, 'batchBuildId_'+biz)
    if (!lockOk) {
        throw new Error(`Get lock fail when batch build id, ${biz}`)
    }
    return model.bulkCreate(templates, {
        updateOnDuplicate:['hex']
    }).then(hexArr=> {
        // bulk create don't guarantee returning the id. In case duplicate occur
        const hasMissing = hexArr.find(bean => isNaN(bean.id)) !== undefined
        if (hasMissing) {
            console.log(`bulk create not fulfilled. ${dt}`)
            const hexWithout0x = templates.map(d => d.hex)
            return model.findAll({where: {hex: {[Op.in]: hexWithout0x}}})
        }
        return hexArr
    }).then(hexArr=>{
        const map = new Map<string, number>()
        hexArr.forEach(bean => map.set(bean.hex, bean.id))
        return map;
    }).finally(()=>{
        hexSet.clear()
        // debugLogCnt && console.log(`finally ${lockKey}`)
        delLock(lockKey).then(()=>{
            if (debugLogCnt > 0) {
                debugLogCnt -= 1
                debugLogCnt && console.log(`del lock key ${lockKey} ${biz}`)
            }
        })
    })
}
export function mapProp(map:Map<any,any>, arr:any[], from:any, to:any) {
    arr.forEach(data=>{ data[to] = map.get(data[from])})
}
export function fillHexId(map:Map<any,any>, arr:any[], hexKey:string, idKey:string) {
    arr.forEach(data=>{ data[idKey] = map.get(data[hexKey]?.substr(2)) || 0})
}
export async function batchBuildId(arr:any[], hexKey:string, idKey:string, model:typeof Hex40Map, biz:string, dt:Date) {
    const set = buildHexSet(undefined, arr, hexKey)
    return buildIdMap(set, model, biz, dt).then(map=>{
        fillHexId(map, arr, hexKey, idKey)
    })
}



export const ADDR_INFO_STATE_OK = 'ok'

export async function hex40IdMap(hex40Array: Array<string>): Promise<Map<string, number>> {
    hex40Array = hex40Array.map(hex=>hex.startsWith('0x') ? hex.substr(2) : hex)
    const result = await Hex40Map.findAll({
        where: {hex: {[Op.in]: hex40Array}},
    })
    const hex40IdMap = new Map<string, number>()
    result.forEach(hex40 => {
        hex40IdMap.set(hex40.hex, hex40.id)
    })
    return hex40IdMap;
}

export function convert2base32map(map: Map<any, string>) : Map<any, string> {
    // hex40 value to base32 value
    const base32map = new Map()
    for (const key of map.keys()) {
        base32map.set(key, formatToBase32('0x'+map.get(key)))
    }
    return base32map
}
export async function idHex40Map(idArray: Array<number|string|unknown>, with0x=false): Promise<Map<number, string>>{
    if (!idArray?.length) {
        return new Map();
    }
    const result = await Hex40Map.findAll({
        where: {id: { [Op.in]: idArray}},
    })
    const idHex40Map = new Map<number, string>()
    result.forEach(hex40=>{
        idHex40Map.set(hex40.id, with0x ? `0x${hex40.hex}` : hex40.hex)
    })
    return idHex40Map;
}

export function mapExtInfo(list:any[], map:object, indexKey:string, tokenKey:string, contractKey:string){
    list.forEach(item => {
        item[tokenKey] = map[item[indexKey]]?.token || {};
        item[contractKey] = map[item[indexKey]]?.contract || {};
    });
}
export function patchBase32prop(list:any[], fromKey: string, toKey: string, isEvm:boolean, netId: number) {
    const base32arr = []
    for(const row of list) {
        const hex = row[fromKey]
        if (hex?.length < 42) {
            continue
        }
        if (isEvm) {
            row[toKey] = formatToBase32(row[fromKey])
        } else {
            row[toKey] = row[fromKey]
        }
        base32arr.push(row[toKey])
    }
    return base32arr
}
export async function getAddrIdArray(addressArray) {
    if(!lodash.isArray(addressArray)) {
        addressArray = [addressArray]
    }
    const hexArray = addressArray.map(item => formatToHex(item));
    const hexIdMap = await hex40IdMap(hexArray);
    return [...hexIdMap.values()];
}
export async function getAddrIdBase32Map(list, ...keys) {
    const addressIdSet = new Set();
    list.forEach(item => keys.forEach(key => addressIdSet.add(item[key])));
    const idHexMap = await idHex40Map([...addressIdSet] as number[]);
    const idBase32Map = convert2base32map(idHexMap);
    return idBase32Map;
}
