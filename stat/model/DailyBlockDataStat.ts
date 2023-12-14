import {DataTypes, Model} from "sequelize";

export interface IDailyBlockDataStat{
    id?: number,
    statTime: Date,
    statType: string,

    blockCount: bigint,
    txCount: bigint,
    difficultySum: bigint,

    blockTime: number,
    hashRate: bigint,
    difficulty: bigint,
    tps: number,
}

export class DailyBlockDataStat extends Model<IDailyBlockDataStat> implements IDailyBlockDataStat{
    id?: number;
    statTime: Date;
    statType: string;

    blockCount: bigint;
    txCount: bigint;
    difficultySum: bigint;

    blockTime: number;
    hashRate: bigint;
    difficulty: bigint;
    tps: number;
    static register(sequelize) {
        DailyBlockDataStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statTime: {type: DataTypes.DATE, allowNull: false},
            statType: {type: DataTypes.CHAR(2), allowNull: false, defaultValue: '1d'},

            blockCount: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
            txCount: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
            difficultySum: {type: DataTypes.DECIMAL(60,0), allowNull: false, defaultValue: 0},

            blockTime: {type: DataTypes.DECIMAL(20,6), allowNull: false, defaultValue: 0},
            tps: {type: DataTypes.DECIMAL(20,6), allowNull: false, defaultValue: 0},
            hashRate: {type: DataTypes.DECIMAL(60,3), allowNull: false, defaultValue: 0},
            difficulty: {type: DataTypes.DECIMAL(60,3), allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'daily_block_data_stat',
            timestamps: true,
            indexes: [{
                name: "idx_statType_statTime",
                fields: ["statType", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(blockDataStat: DailyBlockDataStat, dbTx = undefined): Promise<IDailyBlockDataStat> {
        return await DailyBlockDataStat.create({
            statTime: blockDataStat.statTime,
            statType: blockDataStat.statType,

            blockCount: blockDataStat.blockCount,
            txCount: blockDataStat.txCount,
            difficultySum: blockDataStat.difficultySum,

            blockTime:blockDataStat.blockTime,
            hashRate: blockDataStat.hashRate,
            difficulty: blockDataStat.difficulty,
            tps: blockDataStat.tps,
        }, {
            transaction: dbTx
        })
    }
}