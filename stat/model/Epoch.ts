import {Transaction, DataTypes, Model} from "sequelize";
import {makeId as makeHex64Id} from "./HexMap";

export interface EpochPresent {
    epochNumber: number,
    parentHash: string;
    pivotHash: string;
    timestamp: number;
}

export interface EpochAttributes {
    id: number;
    parentHash: string;
    pivotHash: string;
    timestamp: number;
}

export class Epoch extends Model<EpochAttributes> implements EpochAttributes {
    public id: number;
    parentHash: string;
    pivotHash: string;
    timestamp: number;
    static register(sequelize) {
        Epoch.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false},
            parentHash: {type: DataTypes.CHAR(128), allowNull: true},
            pivotHash: {type: DataTypes.CHAR(128), allowNull: true},
            timestamp: {type: DataTypes.BIGINT, allowNull: true},
        }, {
            tableName: 'epoch',
            sequelize,
            timestamps: false,
            indexes: [
                {
                    name: 'time_idx',
                    fields: ['timestamp']
                },
            ]
        })
    }
    static async add(epoch: EpochPresent, dbTx: Transaction = undefined) : Promise<Epoch> {
        return Epoch.create({
            id: epoch.epochNumber,
            parentHash: epoch.parentHash,
            pivotHash: epoch.pivotHash,
            timestamp: epoch.timestamp
        }, {
            transaction: dbTx
        })
    }
}