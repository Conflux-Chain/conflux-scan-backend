import {DataTypes, Model} from "sequelize";

export interface IDailyTransaction{
    id?: number,
    statDay: Date,
    txCount: number
    gasFee: number
}

export class DailyTransaction extends Model<IDailyTransaction> implements IDailyTransaction{
    id?: number;
    statDay: Date;
    txCount: number;
    gasFee: number;
    static register(sequelize) {
        DailyTransaction.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statDay: {type: DataTypes.DATEONLY, allowNull: false},
            txCount: {type: DataTypes.BIGINT, allowNull: false},
            gasFee: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: '0'},
        },{
            sequelize: sequelize,
            tableName: 'tx_daily',
            timestamps: true,
            indexes: [{
                name: "statDay_idx",
                fields: ["statDay"],
                unique: true,
            }]
        })
    }

    static async add(dailyTx: DailyTransaction, dbTx = undefined){
        return DailyTransaction.upsert({
            statDay: dailyTx.statDay,
            txCount: dailyTx.txCount,
            gasFee: dailyTx.gasFee
        }, {
            transaction: dbTx
        })
    }
}