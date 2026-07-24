import {DataTypes, Model, Sequelize} from "sequelize";
import {CENSOR_STATUS} from "../service/censor/CensorService";

export const T_SENSOR_ITEM = "censor_item";

export interface ICensorItem {
    id?: number;
    epochNumber: number;
    transactionHash: string;
    censorType: number;
    censorStatus?: number;
    createdAt: Date;
    updatedAt: Date;
}

export class CensorItem extends Model<ICensorItem> implements ICensorItem {
    id?: number;
    epochNumber: number;
    transactionHash: string;
    censorType: number;
    censorStatus?: number;
    createdAt: Date;
    updatedAt: Date;

    static register(seq: Sequelize) {
        CensorItem.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            epochNumber: {type: DataTypes.BIGINT, allowNull: false},
            transactionHash: {type: DataTypes.CHAR(66), allowNull: false},
            censorType: {type: DataTypes.INTEGER, allowNull: false},
            censorStatus: {type: DataTypes.INTEGER, allowNull: false, defaultValue: CENSOR_STATUS.TO_CENSOR},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            sequelize: seq,
            tableName: T_SENSOR_ITEM,
            timestamps: false,
            indexes: [
                {name: 'idx_epochNumber', fields: ['epochNumber']},
                {name: 'idx_tx_hash', fields: [{name: 'transactionHash', length: 10}], unique: true},
                {name: 'idx_block_time', fields: [{name: 'createdAt', order: 'DESC'}]},
                {name: 'idx_censorStatus', fields: ['censorStatus']},
            ]
        });
    }
}