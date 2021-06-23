import {DataTypes, Model} from "sequelize";

export interface IDailyContractRegister{
    id?: number,
    statDay: Date,
    contractCount: number
}

export class DailyContractRegister extends Model<IDailyContractRegister> implements IDailyContractRegister{
    id?: number;
    statDay: Date;
    contractCount: number;
    static register(sequelize) {
        DailyContractRegister.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statDay: {type: DataTypes.DATE, allowNull: false},
            contractCount: {type: DataTypes.BIGINT, allowNull: false},
        },{
            sequelize: sequelize,
            tableName: 'daily_contract_register',
            timestamps: true,
            indexes: [{
                name: "statDay_idx",
                fields: ["statDay"],
                unique: true,
            }]
        })
    }

    static async add(dailyContractRegister: DailyContractRegister, dbTx = undefined): Promise<DailyContractRegister> {
        return await DailyContractRegister.create({
            statDay: dailyContractRegister.statDay,
            contractCount: dailyContractRegister.contractCount
        }, {
            transaction: dbTx
        })
    }
}