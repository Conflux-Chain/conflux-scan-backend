import {DataTypes, Model} from "sequelize";

export interface ITopRecord{
    id?: number;
    batchId?: number;
    addressId?:number;
    valueN?: number;
    // top cfx holder has a column 'txn count'
    value2?: number;
    percent: number;
    rank?: number;
}
export const T_TOP_RECORD = "top_record"
export class TopRecord extends Model<ITopRecord> implements ITopRecord{
    id?: number;
    batchId?: number;
    addressId?:number;
    valueN?: number;
    value2?: number;
    percent: number;
    rank?: number;
    static register(sequelize) {
        TopRecord.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true, autoIncrement: true},
            batchId: {type: DataTypes.BIGINT, allowNull: false, field:'batch_id'},
            addressId: {type: DataTypes.BIGINT, allowNull: false, field: 'address_id'},
            valueN: {type: DataTypes.DECIMAL(36, 0), allowNull: false, field: 'value'},
            value2: {type: DataTypes.DECIMAL(36, 18), allowNull: false},
            percent: {type: DataTypes.DECIMAL(12, 10), allowNull: false, defaultValue: 0},
            rank: {type: DataTypes.INTEGER, allowNull: false, },
        }, {
            timestamps: false,
            sequelize: sequelize,
            tableName: T_TOP_RECORD,
            indexes:[
                {
                    name: 'batch_rank',
                    fields: [{name: 'batch_id', order: "DESC"}, {name: 'rank', order: "ASC"}]
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
    // top cfx holder has a column 'txn count'
    value2desc?: string;
}
export const T_TOP_BATCH_INDEX = "batch_index"
export class TopBatchIndex extends Model<ITopBatchIndex> implements ITopBatchIndex{
    id?: number;
    type: string;
    beginTime: Date;
    endTime: Date;
    state: string;
    value2desc?: string;
    static register(sequelize) {
        TopBatchIndex.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true, autoIncrement: true},
            type: {type: DataTypes.CHAR(32), allowNull: false},
            beginTime: {type: DataTypes.DATE, allowNull: false, field: 'begin_time'},
            endTime: {type: DataTypes.DATE, allowNull: false, field: 'end_time'},
            state: {type: DataTypes.CHAR(16), allowNull: false},
            value2desc: {type: DataTypes.CHAR(16), allowNull: false, defaultValue: ''},
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