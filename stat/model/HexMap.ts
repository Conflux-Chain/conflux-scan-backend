import {Sequelize, DataTypes, Model, Transaction, Op} from "sequelize";
import {incDailyAddressCount} from "./StatAddress";
import {delLock, waitLock} from "./Lock";
import {format} from "js-conflux-sdk";
import {StatApp} from "../StatApp";
import {Contract} from "./Contract";
const NodeCache = require( "node-cache" );

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
            return format.address(v, net)
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
            const base32 = format.address(hex, netId)
            await Contract.create({epoch: 0, name, hex40id: hexId, base32})
        }
    }
}
/**
 * mapping a hex64 to a number in DB, to decrease data length and make effective index.
 */
export interface IAddress{
    id: number;
    hex40: string;
    base32: string;
}
export class Address extends Model<IAddress> implements IAddress{
    id: number;
    hex40: string;
    base32: string;
    static register(seq: Sequelize) {
        Address.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
            hex40: {type: DataTypes.CHAR(40), allowNull: false,},
            base32: {type: DataTypes.CHAR(128), allowNull: false,},
        },{
            sequelize: seq,
            timestamps: false,
            tableName: T_ADDRESS,
            indexes: [
                {
                    name: 'addr_hex_40_u',
                    fields: ['hex40'],
                    unique: true,
                }
            ]
        })
    }
}
export interface HexMapAttributes {
    id?: number;
    hex: string
    createdAt?: Date
}
export class Hex64Map extends Model<HexMapAttributes> implements HexMapAttributes {
    public id?: number;
    public hex: string;
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
const base32toHexCache = new NodeCache()
export function formatToHex(address:string) {
    let hex = base32toHexCache.get(address)
    if (hex) {
        return hex;
    }
    hex = format.hexAddress(address);
    base32toHexCache.set(address, hex, cacheTtl)
    return hex;
}
const dbCache = new NodeCache()
const cacheTtl = 60 * 100 // 10 minutes
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
    let map = Hex64Map;
    switch (hex.length) {
        case 64: break;
        case 40: map = Hex40Map; break;
        default: throw new Error(`Unsupported hex length ${hex.length} , ${hex}`)
    }
    const cached = dbCache.get(hex)
    if (cached !== undefined && cached !== null) {
        dbCache.ttl(hex, cacheTtl)
        return cached
    }
    const exists = await map.findOne({where:{hex}})
    if (exists) {
        dbCache.set(hex, exists, cacheTtl);
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
        if (dt && hex.length === 40) incDailyAddressCount(dt, 1).then().catch()
    } else {
        // exists already
        bean = await map.findOne({where:{hex}})
        if (bean === null) {
            console.log(` upsert not created, and find again returns null, hex ${hex}`)
            throw new Error(`How could it happen?`)
        }
    }
    dbCache.set(hex, bean, cacheTtl)
    // console.info(`created ${created}`)
    return bean;
}
export async function getAddrId(addr:string) {
    if (!addr) {
        return -1
    }
    if (addr.startsWith('0x')) {
    } else if (addr.startsWith('cfx') || addr.startsWith('net')){
        addr = format.hexAddress(addr)
    }
    return Hex40Map.findOne({
        where: {hex: addr.substr(2)}
    }).then(res=>{
        return res?.id
    })
}
export function buildHexSet(hexSet:Set<string>, arr:any[], ...hexKey:string[]) : Set<string> {
    if (hexSet === undefined) {
        hexSet = new Set<string>()
    }
    arr.forEach(bean=>{
        hexKey.forEach(k=>hexSet.add(bean[k]))
    });
    return hexSet
}
let debugLogCnt = 10
export async function buildIdMap(hexSet:Set<any>, model:typeof Hex40Map| typeof Hex64Map, biz:string, dt:Date) : Promise<Map<string,number>> {
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
export async function batchBuildId(arr:any[], hexKey:string, idKey:string, model:typeof Hex40Map| typeof Hex64Map, biz:string, dt:Date) {
    const set = buildHexSet(undefined, arr, hexKey)
    return buildIdMap(set, model, biz, dt).then(map=>{
        fillHexId(map, arr, hexKey, idKey)
    })
}
export const T_ADDRESS = 'address'
export function hexMapInit(sequelize) {
    Hex64Map.init(
        {
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
            hex: {type: DataTypes.CHAR(64), allowNull: false,},
            createdAt:{type:DataTypes.VIRTUAL}
        },
        {
            tableName: 'hex64',
            sequelize: sequelize,
            timestamps: false, // prevent default columns: createdAt, updatedAt
            indexes: [
                // {
                    // name: `hex64_index`,
                    // fields: [
                    //     {
                    //         name: 'hex',
                    //         // length: 10,
                    //     }
                    // ],
                    // unique: true
                // }
            ]
        }
    )
}


export const ADDR_INFO_STATE_OK = 'ok'
export const ADDR_INFO_STATE_DELETED = 'deleted'
export interface IAddressInfo {
    id?: number; // refer to hex40 id
    name: string;
    createAt: Date;
    updateAt: Date;
    remark: string;
    state: string; // ok, deleted
}
export const T_ADDRESS_INFO = 'address_info'
export class AddressInfo extends Model<IAddressInfo> implements IAddressInfo {
    id?: number; // refer to hex40 id
    name: string;
    createAt: Date;
    updateAt: Date;
    remark: string;
    state: string;
    static register(seq: Sequelize) {
        AddressInfo.init({
            id:       {type: DataTypes.BIGINT, allowNull: false, primaryKey: true},
            name:     {type: DataTypes.CHAR(32), allowNull: false, unique: true},
            createAt: {type: DataTypes.DATE, allowNull: false},
            updateAt: {type: DataTypes.DATE, allowNull: false},
            remark:   {type: DataTypes.CHAR(128), allowNull: false, defaultValue: ''},
            state:   {type: DataTypes.CHAR(16), allowNull: false, defaultValue: ADDR_INFO_STATE_OK},
        },{
            tableName: T_ADDRESS_INFO,
            sequelize: seq,
            timestamps: false
        })
    }
}

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
        base32map.set(key, format.address('0x'+map.get(key), StatApp.networkId))
    }
    return base32map
}
export async function idHex40Map(idArray: Array<number|string>, with0x=false): Promise<Map<number, string>>{
    const result = await Hex40Map.findAll({
        where: {id: { [Op.in]: idArray}},
    })
    const idHex40Map = new Map<number, string>()
    result.forEach(hex40=>{
        idHex40Map.set(hex40.id, with0x ? `0x${hex40.hex}` : hex40.hex)
    })
    return idHex40Map;
}

export async function idHex64Map(idArray: Array<number>): Promise<Map<number, string>>{
    const result = await Hex64Map.findAll({
        where: {id: { [Op.in]: idArray}},
    })
    const idHex64Map = new Map<number, string>()
    result.forEach(hex64=>{
        idHex64Map.set(hex64.id, hex64.hex)
    })
    return idHex64Map;
}

export function patchBase32prop(list:any[], fromKey: string, toKey: string, isEvm:boolean, netId: number) {
    const base32arr = []
    for(const row of list) {
        const hex = row[fromKey]
        if (hex?.length < 42) {
            continue
        }
        if (isEvm) {
            row[toKey] = format.address(row[fromKey], netId)
        } else {
            row[toKey] = row[fromKey]
        }
        base32arr.push(row[toKey])
    }
    return base32arr
}