import {DataTypes, Model} from "sequelize";

export interface IDailyBurntFeeStat {
    id?: number,
    statType: string,
    statTime: Date,

    burntStorageFee: number,
    burntGasFee: number,
    burntStorageFeeTotal: number,
    burntGasFeeTotal: number,
}

export class DailyBurntFeeStat extends Model<IDailyBurntFeeStat> implements IDailyBurntFeeStat {
    id?: number
    statType: string
    statTime: Date

    burntStorageFee: number
    burntGasFee: number
    burntStorageFeeTotal: number
    burntGasFeeTotal: number

    static register(sequelize) {
        DailyBurntFeeStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statType: {type: DataTypes.CHAR(2), allowNull: false, defaultValue: '1d'},
            statTime: {type: DataTypes.DATE, allowNull: false},

            burntStorageFee: {type: DataTypes.DECIMAL(65, 0), allowNull: false, defaultValue: 0},
            burntGasFee: {type: DataTypes.DECIMAL(65, 0), allowNull: false, defaultValue: 0},
            burntStorageFeeTotal: {type: DataTypes.DECIMAL(65, 0), allowNull: false, defaultValue: 0},
            burntGasFeeTotal: {type: DataTypes.DECIMAL(65, 0), allowNull: false, defaultValue: 0},
        }, {
            sequelize: sequelize,
            tableName: 'daily_burnt_fee_stat',
            timestamps: true,
            indexes: [{
                name: "idx_statType_statTime",
                fields: ["statType", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(record: DailyBurntFeeStat, dbTx = undefined): Promise<IDailyBurntFeeStat> {
        return await DailyBurntFeeStat.create({
            statTime: record.statTime,
            statType: record.statType,

            burntStorageFee: record.burntStorageFee,
            burntGasFee: record.burntGasFee,
            burntStorageFeeTotal: record.burntStorageFeeTotal,
            burntGasFeeTotal: record.burntGasFeeTotal,
        }, {
            transaction: dbTx
        })
    }
}