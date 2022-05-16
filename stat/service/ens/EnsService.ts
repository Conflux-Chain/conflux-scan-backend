import {DataTypes, Model, QueryTypes, Sequelize, Op, fn, col, literal} from 'sequelize'
import {ENS_SEARCH_TEXT_CURSOR, IS_EVM, IS_EVM2, KV} from "../../model/KV";
import {sleep} from "../tool/ProcessTool";
import {queryEnsOfName} from "./ENS";
import {list2map} from "../common/utils";
import {buildHexSet} from "../../model/HexMap";
import {Conflux, format} from "js-conflux-sdk";
import {abi} from "./EnsCheckerAbi";
export interface IENS {
    id?:number; name:string; resolver:string; addr:string;// ttl:number;
}
export class ENS extends Model<IENS> implements IENS {
    id?:number; name:string; resolver:string; addr:string;// ttl:number;
    static register(seq:Sequelize) {
        ENS.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            name: {type: DataTypes.STRING({length:128}),},
            resolver: {type: DataTypes.STRING,},
            addr: {type: DataTypes.STRING,},
            //ttl: {type: DataTypes.INTEGER({}), defaultValue: 0,},
        }, {
            sequelize: seq, tableName: 'ens',
            indexes:[
                {name: 'uk_name', fields: ['name'], unique: true},
                {name: 'idx_addr', fields: ['addr','updatedAt'], unique: false},
            ]
        })
    }
}
export interface ISearchText {
    id?:number; text:string; createdAt?:Date;
}
export class SearchText extends Model<ISearchText> implements ISearchText{
    id?:number; text:string; createdAt?:Date;
    static register(seq:Sequelize) {
        SearchText.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            text: {type: DataTypes.STRING({length:128}),},
            createdAt: {type: DataTypes.DATE},
        },{
            sequelize: seq, tableName: 'search_text', //updatedAt: false,
            indexes: [
                {name: 'idx_date', fields: ['createdAt']}
            ]
        })
    }
}

// ----
let contract = null;
let isEvm = false
let ens = '0xC7b7224F76dD98bE23b717668d55cB40E9B3DF7f' // net71
let reverse = '0x03eD9a24B0c38D1903E34d7787B1EB69B4F8ccfA' //net71
export async function setupEnsChecker(cfx:Conflux) {
    isEvm = await KV.getSwitch(IS_EVM) || await KV.getSwitch(IS_EVM2)
    const {chainId} = await cfx.getStatus()
    if (!isEvm || chainId != 71) {
        return
    }
    isEvm = true;
    if (!contract) {
        let address = '0x14c5eD9a711A44ccEecE0d504B25300E1ac36E2F'
        contract = cfx.Contract({abi, address})
    }
}
export async function matchNamesOnChain(addrArr: string[]) {
    const ret = {ens, reverse}
    const nameArr = await contract.matchNames(ens, reverse, addrArr).catch(err=>{
        console.log(`ens matchNames fail`, err)
        ret["error"] = err;
    })
    for (let i = 0; i < addrArr.length; i++) {
        ret[addrArr[i]] = nameArr[i] || ''
    }
    return ret;
}
export async function fetchEnsMap(list:any[], ...keys:string[]) {
    if (!isEvm) {
        return {isEvm};
    }
    const hexSet = new Set<string>()
    for(const row of list) {
        for(const key of keys) {
            const addr = row[key] || ''
            if (addr.length < 42) {
                continue
            }
            let hex = addr
            if (!addr.startsWith('0x')) {
                hex = format.hexAddress(addr)
                row[`${key}Hex`] = hex
            }
            hexSet.add(hex)
        }
    }
    const hexArr = [...hexSet]
        .filter(addr=>addr?.length >= 42)
        .map(addr => format.hexAddress(addr));
    if (hexArr.length === 0) {
        return {}
    }
    const ensMap = matchNamesOnChain(hexArr);
    for(const row of list) {
        for (const key of keys) {
            let hexKey = `${key}Hex`;
            const hex = row[hexKey]
            delete row[hexKey]
            if (!hex){
                continue
            }
            row[`${key}EnsInfo`] = {
                hex, name: ensMap[hex]
            }
        }
    }
    return ensMap
}
async function matchInDb(hexArr: string[]) {
    const ensList = await ENS.findAll({
        where: {addr: {[Op.in]: hexArr}}, raw: true,
        logging: console.log,
    })
    const ret = {}
    ensList.forEach(ens=>{
        ret[ens.addr] = {name: ens.name}
    })
    return ret
}
export async function syncSearchText() {
    let preCursor = await KV.getNumber(ENS_SEARCH_TEXT_CURSOR, -1)
    const searchText = await SearchText.findOne({
        where: {id: {[Op.gt]: preCursor}}, order: [['id','asc']]
    })
    if (searchText === null) {
        console.log(`not search text after id ${preCursor}`)
        await sleep(5_000)
        return
    }
    const saveCursor = ()=>KV.saveNumber(ENS_SEARCH_TEXT_CURSOR, searchText.id, null)
    const {text} = searchText
    if (!text.includes('.')) {
        await saveCursor()
        return;
    }
    const {resolver, addr, name} = await queryEnsOfName(text)
    await ENS.upsert({
        name, resolver, addr
    })
    await saveCursor()
}

export async function scheduleSyncEnsFromSearchText() {
    async function repeat() {
        await syncSearchText()
        setTimeout(repeat, 100)
    }
    return repeat()
}