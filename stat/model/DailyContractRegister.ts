import {DataTypes, Model} from "sequelize";

export interface IDailyContractRegister{
    id?: number,
    statDay: Date,
    statType: string,
    contractCount: number
}

export class DailyContractRegister extends Model<IDailyContractRegister> implements IDailyContractRegister{
    id?: number;
    statDay: Date;
    statType: string;
    contractCount: number;
    static register(sequelize) {
        DailyContractRegister.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statType: {type: DataTypes.CHAR(3), allowNull: false, defaultValue: '1d'},
            statDay: {type: DataTypes.DATE, allowNull: false},
            contractCount: {type: DataTypes.BIGINT, allowNull: false},
        },{
            sequelize: sequelize,
            tableName: 'daily_contract_register',
            timestamps: true,
            indexes: [{
                name: "idx_statType_statDay",
                fields: ["statType", "statDay"],
                unique: true,
            }]
        })
    }

    static async add(dailyContractRegister: DailyContractRegister, dbTx = undefined): Promise<DailyContractRegister> {
        return await DailyContractRegister.create({
            statDay: dailyContractRegister.statDay,
            statType: dailyContractRegister.statType,
            contractCount: dailyContractRegister.contractCount
        }, {
            transaction: dbTx
        })
    }
}