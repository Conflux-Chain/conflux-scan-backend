import {DataTypes, Model} from "sequelize";

export interface IDailyContractStat{
    id?: number,
    hex40id:number,
    statTime: Date,
    tx: number,
    cfxTransfer: number,
    tokenType?:string,
    tokenTransfer: number,
}

export class DailyContractStat extends Model<IDailyContractStat> implements IDailyContractStat{
    id?: number;
    hex40id: number;
    statTime: Date;
    tx: number;
    cfxTransfer: number;
    tokenType?:string;
    tokenTransfer: number;
    static register(sequelize) {
        DailyContractStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            hex40id: {type: DataTypes.BIGINT, allowNull: false},
            statTime: {type: DataTypes.DATE, allowNull: false},
            tx: {type: DataTypes.BIGINT, allowNull: false},
            cfxTransfer: {type: DataTypes.BIGINT, allowNull: false},
            tokenType: {type: DataTypes.CHAR(16), allowNull: false, defaultValue: ''},
            tokenTransfer: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'daily_contract_stat',
            timestamps: true,
            indexes: [{
                name: "hex40id_statTime_idx",
                fields: ["hex40id", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(dailyContractStat: DailyContractStat, dbTx = undefined): Promise<IDailyContractStat> {
        return await DailyContractStat.create({
            hex40id: dailyContractStat.hex40id,
            statTime: dailyContractStat.statTime,
            tx: dailyContractStat.tx,
            cfxTransfer: dailyContractStat.cfxTransfer,
            tokenType:dailyContractStat.tokenType,
            tokenTransfer: dailyContractStat.tokenTransfer,
        }, {
            transaction: dbTx
        })
    }
}