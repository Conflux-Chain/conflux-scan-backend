import {QueryTypes, Op, Sequelize, Transaction, DataTypes, Model} from "sequelize";

export interface IErrorLog {
    id:number
    message:string
    remark: string
}
export class StreamErrorLog extends Model<IErrorLog> implements IErrorLog {
    id:number
    message:string
    remark:string
    static register(seq:Sequelize) {
        StreamErrorLog.init({
          id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
          message: {type: DataTypes.TEXT({length:'long'})},
          remark: {type: DataTypes.STRING(512), allowNull:true}
        },{
            sequelize: seq,
            tableName: 'stream_error'
        })

    }
}