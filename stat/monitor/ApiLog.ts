import {
    Transaction,
    Model,
    DataTypes,
    Sequelize,
    Op,
    UniqueConstraintError,
    ModelStatic,
    DatabaseError
} from "sequelize";
import {API_LOG_RT_LIMIT, KV} from "../model/KV";

export interface IApiLog {
    id?:number; path:string; query:string; rt:number; createdAt:Date;
}
export class ApiLog extends Model<IApiLog> implements IApiLog {
    id?:number; path:string; query:string; rt:number; createdAt:Date;
    static register(seq:Sequelize) {
        ApiLog.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true, autoIncrement: true},
            path: {type: DataTypes.STRING(256), allowNull: false},
            query: {type: DataTypes.STRING(2048), allowNull: false},
            rt: {type: DataTypes.INTEGER, allowNull: false},
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

let rtThreshold = 1000
setInterval(()=>{
        KV.getNumber(API_LOG_RT_LIMIT, 1000).then(v=>{
            rtThreshold = v
        }).catch()
    }, 5000)

let skipUrls = new Set<string>()
skipUrls.add('/stat/nft/checker/preview')

export async function saveApiLog(ctx:any, rt:number) {
    const {url} = ctx;
    if (rt < rtThreshold) {
        return
    }
    let [path, query=''] = url.split('?');
    if (skipUrls.has(path)) {
        return
    }
    const externalMs = ctx.get('external-ms') || 0
    if (externalMs > rtThreshold){
        console.log(`external ms`, path, externalMs)
    }
    if (query) {
        query = decodeURIComponent(query);
    }
    ApiLog.create({
        path, query, createdAt: new Date(), rt: rt - externalMs,
    }).then()
}