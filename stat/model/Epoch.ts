import {DataTypes, Model, Op} from "sequelize";

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
            pivotHash: {type: DataTypes.CHAR(128), allowNull: false},
            timestamp: {type: DataTypes.DATE, allowNull: false},
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
}

export enum ClosestType {
    AFTER = 'after',
    BEFORE = 'before',
}

export async function closestEpochByTimeStamp(closest: ClosestType, timestampInSec: number) {
    const [comparator, order] = closest === ClosestType.AFTER ? [Op.gte, 'ASC'] : [Op.lte, 'DESC']
    const datetime = new Date(timestampInSec * 1000)

    const epoch = await Epoch.findOne({
        where: {timestamp: {[comparator]: datetime}},
        order: [['timestamp', order]],
    })

    return epoch?.epoch
}

export async function getEpochRange(minTimestamp, maxTimestamp, minEpochNumber, maxEpochNumber) {
    let epochBegin: number, epochEnd: number

    if (minTimestamp !== undefined) {
        const minEpoch = await Epoch.findOne({
            where: {timestamp: {[Op.gte]: new Date(minTimestamp * 1000)}},
            order: [['timestamp', 'asc']]
        })
        if (minEpoch) {
            epochBegin = minEpochNumber === undefined ? minEpoch.epoch : Math.max(minEpoch.epoch, minEpochNumber)
        }
    }

    if (maxTimestamp !== undefined) {
        const maxEpoch = await Epoch.findOne({
            where: {timestamp: {[Op.lte]: new Date(maxTimestamp * 1000)}},
            order: [['timestamp', 'desc']]
        })
        if (maxEpoch) {
            epochEnd = maxEpochNumber === undefined ? maxEpoch.epoch : Math.min(maxEpoch.epoch, maxEpochNumber)
        }
    }

    return {epochBegin, epochEnd}
}

export interface IVoteParams {
    epoch: number,
    storagePointProp: number,
    baseFeeShareProp: number,
    timestamp: Date,
}

export class VoteParams extends Model<IVoteParams> implements IVoteParams {
    epoch: number
    storagePointProp: number
    baseFeeShareProp: number
    timestamp: Date

    static register(sequelize) {
        VoteParams.init({
            epoch: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false},
            storagePointProp: {type: DataTypes.DECIMAL(65, 0), allowNull: false},
            baseFeeShareProp: {type: DataTypes.DECIMAL(65, 0), allowNull: false},
            timestamp: {type: DataTypes.DATE, allowNull: false},
        }, {
            sequelize: sequelize,
            tableName: 'vote_params',
            timestamps: false,
            indexes: [
                {
                    name: 'time_idx',
                    fields: ['timestamp']
                },
            ]
        })
    }

    static async add(record: VoteParams, dbTx = undefined): Promise<IVoteParams> {
        return await VoteParams.create({
            epoch: record.epoch,
            storagePointProp: record.storagePointProp,
            baseFeeShareProp: record.baseFeeShareProp,
            timestamp: record.timestamp,
        }, {
            transaction: dbTx
        })
    }
}
