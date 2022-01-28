import {DataTypes, Model} from "sequelize";

export interface IDailyContractCreate{
    id?: number,
    statDay: Date,
    contractCount: number
    contractTotal: number
}

export class DailyContractCreate extends Model<IDailyContractCreate> implements IDailyContractCreate{
    id?: number;
    statDay: Date;
    contractCount: number;
    contractTotal: number;
    static register(sequelize) {
        DailyContractCreate.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statDay: {type: DataTypes.DATE, allowNull: false},
            contractCount: {type: DataTypes.BIGINT, allowNull: false},
            contractTotal: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'daily_contract_create',
            timestamps: true,
            indexes: [{
                name: "statDay_idx",
                fields: ["statDay"],
                unique: true,
            }]
        })
    }

    static async add(dailyContractCreate: DailyContractCreate, dbTx = undefined): Promise<DailyContractCreate> {
        return await DailyContractCreate.create({
            statDay: dailyContractCreate.statDay,
            contractCount: dailyContractCreate.contractCount,
            contractTotal: dailyContractCreate.contractTotal,
        }, {
            transaction: dbTx
        })
    }
}