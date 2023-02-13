import {DataTypes, Model, Sequelize, QueryTypes} from "sequelize";
import {API_LOG_RT_LIMIT, KV} from "../model/KV";

const requestIp = require('request-ip');

export interface IApiLog {
    id?:number; path:string; query:string; rt:number; createdAt:Date; ip:string;
}
export class ApiLog extends Model<IApiLog> implements IApiLog {
    id?:number; path:string; query:string; rt:number; createdAt:Date; ip:string;
    static register(seq:Sequelize) {
        ApiLog.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true, autoIncrement: true},
            path: {type: DataTypes.STRING(256), allowNull: false},
            query: {type: DataTypes.STRING(2048), allowNull: false},
            rt: {type: DataTypes.INTEGER, allowNull: false},
            ip: {type: DataTypes.STRING(64), allowNull: false, defaultValue:''},
            createdAt: {type: DataTypes.DATE, allowNull: false},
        },{
            sequelize: seq, tableName: 'api_log', updatedAt: false,
            indexes: [
                {name: 'idx_dt', fields: ['createdAt']},
                {name: 'idx_path', fields: ['path','rt']},
                {name: 'idx_rt', fields: ['rt']},
            ]
        })
    }
}

export async function checkApiLogIpField() {
    const descRes = await ApiLog.sequelize.query(`desc ${ApiLog.getTableName()}`, {type: QueryTypes.SELECT, raw: true})
    console.log(`api log table`, descRes)
    let ipField = (descRes as any[]).find(col=>col.Field === 'ip')[0];
    if (ipField) {
        return;
    }
    await ApiLog.sequelize.query(`alter table ${ApiLog.getTableName()} add column ip varchar(64) not null default ''`, {type: QueryTypes.UPDATE});
    console.log(`added ip field on ApiLog`);
}

let rtThreshold = 1000
KV.sequelize && setInterval(()=>{
        KV.getNumber(API_LOG_RT_LIMIT, 1000).then(v=>{
            rtThreshold = v
        }).catch()
    }, 5000)

let skipUrls = new Set<string>()
skipUrls.add('/stat/nft/checker/preview')
skipUrls.add('/open/nft/preview')

export async function saveApiLog(ctx:any, rt:number) {
    const {url} = ctx;
    if (rt < rtThreshold) {
        return
    }
    let [path, query=''] = url.split('?');
    if (skipUrls.has(path)) {
        return
    }
    const externalMs = ctx.response.get('external-ms') || 0
    if (externalMs > rtThreshold){
        console.log(`external ms costs`, path, externalMs)
    }
    rt = rt - externalMs
    if (rt < rtThreshold) {
        return
    }
    if (query) {
        query = decodeURIComponent(query);
    }
    const ip = requestIp.getClientIp(ctx.request);
    ApiLog.create({
        path, query, createdAt: new Date(), rt, ip,
    }).then()
}