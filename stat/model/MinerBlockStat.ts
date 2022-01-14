import {DataTypes, Model} from "sequelize";

export interface IMinerBlockStat{
    id?: number;
    bizId: number;
    statType: string;
    statTime: Date;
    blockCntr: bigint;
    rewardSum: bigint;
    txFeeSum: bigint;
    difficultySum: bigint;
    minEpoch: number;
    maxEpoch: number;
}

export class MinerBlockStat extends Model<IMinerBlockStat> implements IMinerBlockStat{
    id?: number;
    bizId: number;
    statType: string;
    statTime: Date;
    blockCntr: bigint;
    rewardSum: bigint;
    txFeeSum: bigint;
    difficultySum: bigint;
    minEpoch: number;
    maxEpoch: number;

    static register(sequelize) {
        MinerBlockStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            bizId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            statType: {type: DataTypes.CHAR(2), allowNull: false, defaultValue: '1d'},
            statTime: {type: DataTypes.DATE, allowNull: false},
            blockCntr: {type: DataTypes.DECIMAL(60,0), allowNull: false, defaultValue: 0},
            rewardSum: {type: DataTypes.DECIMAL(60,0), allowNull: false, defaultValue: 0},
            txFeeSum: {type: DataTypes.DECIMAL(60,0), allowNull: false, defaultValue: 0},
            difficultySum: {type: DataTypes.DECIMAL(60,0), allowNull: false, defaultValue: 0},
            minEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            maxEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'stat_miner_block',
            timestamps: true,
            indexes: [{
                name: "idx_bizId_statType_statTime",
                fields: ["bizId", "statType", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(minerBlockStat: MinerBlockStat, dbTx = undefined): Promise<MinerBlockStat> {
        return await MinerBlockStat.create({
            bizId: minerBlockStat.bizId,
            statType: minerBlockStat.statType,
            statTime: minerBlockStat.statTime,
            blockCntr: minerBlockStat.blockCntr,
            rewardSum: minerBlockStat.rewardSum,
            txFeeSum: minerBlockStat.txFeeSum,
            difficultySum: minerBlockStat.difficultySum,
            minEpoch: minerBlockStat.minEpoch,
            maxEpoch: minerBlockStat.maxEpoch,
        }, {
            transaction: dbTx
        })
    }
}