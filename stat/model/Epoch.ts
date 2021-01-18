import {Transaction, DataTypes, Model} from "sequelize";
import {makeId as makeHex64Id} from "./HexMap";

export interface EpochPresent {
    epochNumber: number,
    parentHash: string;
    pivotHash: string;
    timestamp: Date;
}

export interface EpochAttributes {
    id: number;
    timestamp: Date;
    parentHash: number;
    pivotHash: number;

}

export class Epoch extends Model<EpochAttributes> implements EpochAttributes {
    public id: number;
    timestamp: Date;
    parentHash: number;
    pivotHash: number;
    static register(sequelize) {
        Epoch.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false},
            timestamp: {type: DataTypes.DATE, allowNull: false},
            parentHash: {type: DataTypes.BIGINT, allowNull: false},
            pivotHash: {type: DataTypes.BIGINT, allowNull: false},
        }, {
            tableName: 'Epoch',
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
        let parentId = await makeHex64Id(epoch.parentHash);
        let pivotId = await makeHex64Id(epoch.pivotHash);
        return Epoch.create({
            id: epoch.epochNumber,
            parentHash: parentId.id,
            pivotHash: pivotId.id,
            timestamp: epoch.timestamp
        }, {
            transaction: dbTx
        })
    }
}