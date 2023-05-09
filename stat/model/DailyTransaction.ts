import {DataTypes, Model} from "sequelize";

export interface IDailyTransaction{
    id?: number,
    statDay: Date,
    statType: string,
    txCount: number
    senderCount: number
    gasFee: number
}

export class DailyTransaction extends Model<IDailyTransaction> implements IDailyTransaction{
    id?: number;
    statDay: Date;
    statType: string;
    txCount: number;
    senderCount: number;
    gasFee: number;
    static register(sequelize) {
        DailyTransaction.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statDay: {type: DataTypes.DATE, allowNull: false},
            statType: {type: DataTypes.CHAR(3), allowNull: false, defaultValue: '1d'},
            txCount: {type: DataTypes.BIGINT, allowNull: false},
            senderCount: {type: DataTypes.BIGINT, allowNull: true},
            gasFee: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: '0'},
        },{
            sequelize: sequelize,
            tableName: 'tx_daily',
            timestamps: true,
            indexes: [{
                name: "idx_statDay_statType",
                fields: ["statDay", "statType"],
                unique: true,
            }]
        })
    }

    static async add(dailyTx: DailyTransaction, dbTx = undefined){
        return DailyTransaction.upsert({
            statDay: dailyTx.statDay,
            statType: dailyTx.statType,
            txCount: dailyTx.txCount,
            senderCount: dailyTx.gasFee,
            gasFee: dailyTx.gasFee
        }, {
            transaction: dbTx
        })
    }
}