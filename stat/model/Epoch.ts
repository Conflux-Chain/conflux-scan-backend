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
}

export class EpochNftTransfer extends Model<IEpoch> implements IEpoch {
    public epoch: number;
    pivotHash: string;
    timestamp: Date;
    static register(sequelize) {
        EpochNftTransfer.init({
            epoch: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false},
            pivotHash: {type: DataTypes.CHAR(128), allowNull: true},
            timestamp: {type: DataTypes.DATE, allowNull: true},
        }, {
            tableName: 'epoch_nft_transfer',
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

export async function getEpochRange(minTimestamp, maxTimestamp, minEpochNumber, maxEpochNumber) {
    let epochBegin: number, epochEnd: number

    if (minTimestamp !== undefined) {
        const minEpoch = await Epoch.findOne({
            where: {timestamp:{[Op.gte]: new Date(minTimestamp*1000)}},
            order: [['timestamp', 'asc']]
        })
        if(minEpoch) {
            epochBegin = minEpochNumber === undefined ? minEpoch.epoch : Math.max(minEpoch.epoch, minEpochNumber)
        }
    }

    if (maxTimestamp !== undefined) {
        const maxEpoch = await Epoch.findOne({
            where: {timestamp:{[Op.lte]: new Date(maxTimestamp*1000)}},
            order: [['timestamp', 'desc']]
        })
        if(maxEpoch) {
            epochEnd = maxEpochNumber === undefined ? maxEpoch.epoch : Math.min(maxEpoch.epoch, maxEpochNumber)
        }
    }

    return {epochBegin, epochEnd}
}

// CREATE TABLE `epoch_nft_transfer` (
//     `epoch` bigint(20) NOT NULL,
//     `timestamp` datetime NOT NULL,
//     `pivotHash` varchar(128) NOT NULL,
//     PRIMARY KEY (`epoch`),
//     KEY `time_idx` (`timestamp`)
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8
// /*!50100 PARTITION BY RANGE (epoch)
// (PARTITION p1 VALUES LESS THAN (10000000) ENGINE = InnoDB,
//  PARTITION p2 VALUES LESS THAN (20000000) ENGINE = InnoDB,
//  PARTITION p3 VALUES LESS THAN (30000000) ENGINE = InnoDB,
//  PARTITION p4 VALUES LESS THAN (40000000) ENGINE = InnoDB,
//  PARTITION p5 VALUES LESS THAN (50000000) ENGINE = InnoDB,
//  PARTITION p6 VALUES LESS THAN (60000000) ENGINE = InnoDB,
//  PARTITION p7 VALUES LESS THAN (70000000) ENGINE = InnoDB,
//  PARTITION p8 VALUES LESS THAN (80000000) ENGINE = InnoDB,
//  PARTITION p9 VALUES LESS THAN (90000000) ENGINE = InnoDB,
//  PARTITION p10 VALUES LESS THAN (100000000) ENGINE = InnoDB,
//  PARTITION p11 VALUES LESS THAN (110000000) ENGINE = InnoDB,
//  PARTITION p12 VALUES LESS THAN (120000000) ENGINE = InnoDB,
//  PARTITION p13 VALUES LESS THAN (130000000) ENGINE = InnoDB) */

export interface IVoteParams{
    epoch: number,
    storagePointProp: number,
    baseFeeShareProp: number,
    timestamp: Date,
}

export class VoteParams extends Model<IVoteParams> implements IVoteParams{
    epoch: number
    storagePointProp: number
    baseFeeShareProp: number
    timestamp: Date
    static register(sequelize) {
        VoteParams.init({
            epoch: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false},
            storagePointProp: {type: DataTypes.DECIMAL(65,0), allowNull: true},
            baseFeeShareProp: {type: DataTypes.DECIMAL(65,0), allowNull: true},
            timestamp: {type: DataTypes.DATE, allowNull: false},
        },{
            sequelize: sequelize,
            tableName: 'vote_params',
            timestamps: false,
            indexes: []
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