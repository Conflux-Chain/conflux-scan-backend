import {DataTypes, Model} from "sequelize";

export interface IBlock {
    id: number;
    miner: string;
    hash: string;
    epoch: number;
    difficulty: number;
    totalReward: BigInteger;
}

export interface IBlockAttributes {
    syncId: number;
    minerId: number;
    hashId: number;
    epoch: number;
    difficulty: number;
    createAt: Date,
    totalReward: bigint;
    txFee: bigint;
}

export class Block extends Model<IBlockAttributes> implements IBlockAttributes {
    epoch: number;
    createAt: Date;
    difficulty: number;
    minerId: number;
    hashId: number;
    syncId: number;
    totalReward: bigint;
    txFee: bigint;

    static findMax() {
        return Block.scope("maxOneById").findOne()
    }

    static register(sequelize) {
        Block.init({
            syncId: {type: DataTypes.BIGINT, allowNull: false},
            difficulty: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createAt: {type: DataTypes.DATE, allowNull: false},
            minerId: {type: DataTypes.BIGINT, allowNull: false},
            hashId: {type: DataTypes.BIGINT, allowNull: false, unique: true},
            totalReward: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
            txFee: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
        }, {
            tableName: 'Block',
            sequelize,
            timestamps: false,
            indexes: [
                {
                    name: 'miner_idx',
                    fields: ['minerId']
                },{
                    name: 'block_time_idx', // index name must be unique globally under sqlite.
                    fields: [{name: 'createAt', order: 'DESC'}]
                }
            ],
            scopes: {
                maxOneById: {
                    limit: 1,
                    order: [["id", "desc"]]
                },
            }
        })
    }
}