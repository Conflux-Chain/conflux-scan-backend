import {Transaction, DataTypes, Model} from "sequelize";

export interface IEpoch {
    epoch: number;
    pivotHash: string;
    timestamp: Date;
}

export class Epoch extends Model<IEpoch> implements IEpoch {
    public epoch: number;
    pivotHash: string;
    timestamp: Date;
    static register(sequelize) {
        Epoch.init({
            epoch: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false},
            pivotHash: {type: DataTypes.CHAR(128), allowNull: true},
            timestamp: {type: DataTypes.DATE, allowNull: true},
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
    static async add(epoch: IEpoch, dbTx: Transaction = undefined) : Promise<Epoch> {
        return Epoch.create({
            epoch: epoch.epoch,
            pivotHash: epoch.pivotHash,
            timestamp: epoch.timestamp
        }, {
            transaction: dbTx
        })
    }
}