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
            sequelize: seq, tableName: 'api_log',
            indexes: [
                {name: 'idx_dt', fields: ['createdAt']},
                {name: 'idx_path', fields: ['path','rt']},
                {name: 'idx_rt', fields: ['rt']},
            ]
        })
    }
}
let rtThreshold = 1000
export async function saveApiLog({url}, rt:number) {
    if (rt < rtThreshold) {
        return
    }
    let [path, query=''] = url.split('?');
    if (query) {
        query = decodeURIComponent(query)
    }
    ApiLog.create({
        path, query, createdAt: new Date(), rt,
    }).then()
}