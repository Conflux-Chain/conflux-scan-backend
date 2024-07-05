import {DataTypes, Model} from "sequelize";

export interface IDailyContractCreate{
    id?: number,
    statDay: Date,
    statType: string,
    contractCount: number
    contractTotal: number
}

export class DailyContractCreate extends Model<IDailyContractCreate> implements IDailyContractCreate{
    id?: number;
    statDay: Date;
    statType: string;

    contractCount: number;
    contractTotal: number;
    static register(sequelize) {
        DailyContractCreate.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statDay: {type: DataTypes.DATE, allowNull: false},
            statType: {type: DataTypes.CHAR(3), allowNull: false, defaultValue: '1d'},
            contractCount: {type: DataTypes.BIGINT, allowNull: false},
            contractTotal: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'daily_contract_create',
            timestamps: true,
            indexes: [{
                name: "idx_statType_statDay",
                fields: ["statType", "statDay"],
                unique: true,
            }]
        })
    }

    static async add(dailyContractCreate: DailyContractCreate, dbTx = undefined): Promise<DailyContractCreate> {
        return await DailyContractCreate.create({
            statDay: dailyContractCreate.statDay,
            statType: dailyContractCreate.statType,
            contractCount: dailyContractCreate.contractCount,
            contractTotal: dailyContractCreate.contractTotal,
        }, {
            transaction: dbTx
        })
    }
}

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