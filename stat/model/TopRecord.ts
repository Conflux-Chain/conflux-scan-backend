import {DataTypes, Model} from "sequelize";

export interface ITopRecord{
    id?: number;
    batchId?: number;
    addressId?:number;
    valueN?: number;
    rank?: number;
}
export const T_TOP_RECORD = "top_record"
export class TopRecord extends Model<ITopRecord> implements ITopRecord{
    id?: number;
    batchId?: number;
    addressId?:number;
    valueN?: number;
    rank?: number;
    static register(sequelize) {
        TopRecord.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true, autoIncrement: true},
            batchId: {type: DataTypes.BIGINT, allowNull: false, },
            addressId: {type: DataTypes.BIGINT, allowNull: false, },
            valueN: {type: DataTypes.DECIMAL(36, 0), allowNull: false, },
            rank: {type: DataTypes.INTEGER, allowNull: false, },
        }, {
            timestamps: false,
            sequelize: sequelize,
            tableName: T_TOP_RECORD,
            indexes:[
                {
                    name: 'batch_rank',
                    fields: [{name: 'batchId', order: "DESC"}, {name: 'rank', order: "ASC"}]
                }
            ]
        })
    }
}
export const STATE_OK = 'ok'
export const STATE_INIT = 'init'
export const STATE_DELETED = 'deleted'
export const TOP_CFX_HOLD = 'TOP_CFX_HOLD'
export interface ITopBatchIndex{
    id?: number;
    type: string;
    beginTime: Date;
    endTime: Date;
    state: string;
}
export const T_TOP_BATCH_INDEX = "top_batch_index"
export class TopBatchIndex extends Model<ITopBatchIndex> implements ITopBatchIndex{
    id?: number;
    type: string;
    beginTime: Date;
    endTime: Date;
    state: string;
    static register(sequelize) {
        TopBatchIndex.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true, autoIncrement: true},
            type: {type: DataTypes.CHAR(32), allowNull: false},
            beginTime: {type: DataTypes.DATE, allowNull: false, field: 'begin_time'},
            endTime: {type: DataTypes.DATE, allowNull: false, field: 'end_time'},
            state: {type: DataTypes.CHAR(16), allowNull: false},
        },{
            timestamps: false,
            sequelize: sequelize,
            tableName: T_TOP_BATCH_INDEX,
            indexes: [
                {
                    name: 'type_id',
                    fields: [{name: 'type'}, {name:'id', order:"DESC"}]
                }
            ]
        })
    }
}