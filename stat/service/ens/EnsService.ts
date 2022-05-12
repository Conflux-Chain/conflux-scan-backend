import {DataTypes, Model, QueryTypes, Sequelize, Op, fn, col, literal} from 'sequelize'
import {ENS_SEARCH_TEXT_CURSOR, KV} from "../../model/KV";
import {sleep} from "../tool/ProcessTool";
import {queryEnsOfName} from "./ENS";
import {list2map} from "../common/utils";
import {buildHexSet} from "../../model/HexMap";
import {format} from "js-conflux-sdk";
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
export async function fetchEnsMap(list:any[], ...keys:string[]) {
    const hexArr = [...buildHexSet(undefined, list, ...keys)].map(addr=>format.hexAddress(addr))
    if (hexArr.length === 0) {
        return {}
    }
    const ensList = await ENS.findAll({
        where: {addr: {[Op.in]: hexArr}}, raw: true,
        logging: console.log,
    })
    return list2map(ensList, 'addr')
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