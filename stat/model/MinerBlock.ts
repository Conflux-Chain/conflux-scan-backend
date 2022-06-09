import {DataTypes, Model} from "sequelize";

/**
 * statistic block mined by miner between N minutes.
 */
export interface IMinerBlock {
    id?: number;
    minerId: number;
    miner?: string;
    blockCount: number;
    difficultySum: number;
    hashRate?: number,
    beginTime: Date;
    endTime: Date;
    timeWindow: string;
    totalReward: bigint;
    txFee: bigint;
    rank?: number;
}

export class MinerBlock extends Model<IMinerBlock> implements IMinerBlock {
    beginTime: Date;
    blockCount: number;
    difficultySum: number;
    endTime: Date;
    id?: number;
    minerId: number;
    miner?: string;
    timeWindow: string;
    totalReward: bigint;
    txFee: bigint;

    static register(sequelize) {
        MinerBlock.init({
                id: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true, autoIncrement: true},
                minerId: DataTypes.BIGINT,
                blockCount: DataTypes.BIGINT,
                difficultySum: DataTypes.BIGINT,
                beginTime: DataTypes.DATE,
                endTime: DataTypes.DATE,
                timeWindow: DataTypes.CHAR(8),
                totalReward: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
                txFee: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
            }
            , {
                timestamps: false,
                sequelize: sequelize,
                tableName: 'minerBlock',
                indexes: [{
                    name: 'mine_dt_idx', unique: true,
                    fields: ['beginTime', 'minerId']
                }],
            })
    }
}