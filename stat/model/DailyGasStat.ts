import {DataTypes, Model} from "sequelize";

export interface IDailyGasStat{
    id?: number,
    statTime: Date,
    statType: string,

    blockCount: bigint,
    txCount: bigint,
    gasLimitSum: bigint,
    gasUsedSum: bigint,
    gasPriceSum: bigint,

    gasLimitAvg: bigint,
    gasPriceMin: bigint,
    gasPriceMax: bigint,
    gasPriceAvg: bigint,
    networkUtilization: number,
}

export class DailyGasStat extends Model<IDailyGasStat> implements IDailyGasStat{
    id?: number;
    statTime: Date;
    statType: string;

    blockCount: bigint;
    txCount: bigint;
    gasLimitSum: bigint;
    gasUsedSum: bigint;
    gasPriceSum: bigint;

    gasLimitAvg: bigint;
    gasPriceMin: bigint;
    gasPriceMax: bigint;
    gasPriceAvg: bigint;
    networkUtilization: number;
    static register(sequelize) {
        DailyGasStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statTime: {type: DataTypes.DATE, allowNull: false},
            statType: {type: DataTypes.CHAR(2), allowNull: false, defaultValue: '1d'},

            blockCount: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
            txCount: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
            gasLimitSum: {type: DataTypes.DECIMAL(65,0), allowNull: false, defaultValue: 0},
            gasUsedSum: {type: DataTypes.DECIMAL(65,0), allowNull: false, defaultValue: 0},
            gasPriceSum: {type: DataTypes.DECIMAL(65,0), allowNull: false, defaultValue: 0},

            gasLimitAvg: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
            gasPriceMin: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
            gasPriceMax: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
            gasPriceAvg: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
            networkUtilization: {type: DataTypes.DECIMAL(5,4), allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'daily_gas_stat',
            timestamps: true,
            indexes: [{
                name: "idx_statType_statTime",
                fields: ["statType", "statTime"],
                unique: true,
            }]
        })
    }
}