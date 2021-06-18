import {Sequelize, DataTypes, Model, Transaction, Op} from "sequelize";
import {incDailyAddressCount} from "./StatAddress";
import {delLock, waitLock} from "./Lock";
const NodeCache = require( "node-cache" );

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
const dbCache = new NodeCache()
const cacheTtl = 60 * 10 // 10 minutes

// https://sequelize.org/master/class/lib/model.js~Model.html#static-method-findOrCreate
export async function makeId(hex: string, dbTx: Transaction = undefined, {dt = undefined} = {}) {
    if (hex === '0x0' || hex === undefined || hex === null) {
        return {id:0};
    }
    if (hex.startsWith('0x')) {
        hex = hex.substr(2);
    }
    let map = Hex64Map;
    switch (hex.length) {
        case 64: break;
        case 40: map = Hex40Map; break;
        default: throw new Error(`Unsupported hex length ${hex.length}`)
    }
    const cached = dbCache.get(hex)
    if (cached !== undefined) {
        dbCache.ttl(hex, cacheTtl)
        return cached
    }
    const values:HexMapAttributes = {hex: hex};
    if (dt) values.createdAt = dt
    // console.log(`hex map for:`, values)
    let [bean, created] = await map.upsert(values, {
        transaction: dbTx, fields:['hex'],
        // logging: console.log
    });
    if (created) {
        // hex40 has field createdAt
        if (dt && hex.length === 40) incDailyAddressCount(dt, 1).then().catch()
    } else {
        // exists already
        bean = await map.findOne({where:{hex}, transaction: dbTx})
    }
    dbCache.set(hex, bean, cacheTtl)
    // console.info(`created ${created}`)
    return bean;
}
export function buildHexSet(hexSet:Set<string>, arr:any[], hexKey:string) : Set<string> {
    if (hexSet === undefined) {
        hexSet = new Set<string>()
    }
    arr.forEach(bean=>{
        hexSet.add(bean[hexKey])
    });
    return hexSet
}
let debugLogCnt = 10
export async function buildIdMap(hexSet:Set<string>, model:typeof Hex40Map| typeof Hex64Map, biz:string, dt:Date) : Promise<Map<string,number>> {
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
export function fillHexId(map:Map<string,number>, arr:any[], hexKey:string, idKey:string) {
    arr.forEach(data=>{ data[idKey] = map.get(data[hexKey].substr(2)) || 0})
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
    const result = await Hex40Map.findAll({
        where: {hex: {[Op.in]: hex40Array}},
    })
    const hex40IdMap = new Map<string, number>()
    result.forEach(hex40 => {
        hex40IdMap.set(hex40.hex, hex40.id)
    })
    return hex40IdMap;
}

export async function idHex40Map(idArray: Array<number>): Promise<Map<number, string>>{
    const result = await Hex40Map.findAll({
        where: {id: { [Op.in]: idArray}},
    })
    const idHex40Map = new Map<number, string>()
    result.forEach(hex40=>{
        idHex40Map.set(hex40.id, hex40.hex)
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
