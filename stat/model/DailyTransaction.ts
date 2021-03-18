import {DataTypes, Model} from "sequelize";

export interface IDailyTransaction{
    id?: number,
    statDay: string,
    txCount: number
}

export class DailyTransaction extends Model<IDailyTransaction> implements IDailyTransaction{
    id?: number;
    statDay: string;
    txCount: number;
    static register(sequelize) {
        DailyTransaction.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statDay: {type: DataTypes.CHAR(8), allowNull: false},
            txCount: {type: DataTypes.BIGINT, allowNull: false},
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

    static async add(dailyTx: DailyTransaction, dbTx = undefined): Promise<IDailyTransaction> {
        return await DailyTransaction.create({
            statDay: dailyTx.statDay,
            txCount: dailyTx.txCount
        }, {
            transaction: dbTx
        })
    }
}