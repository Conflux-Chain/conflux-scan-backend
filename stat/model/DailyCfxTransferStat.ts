import {DataTypes, Model} from "sequelize";

export interface IDailyCfxTransferStat{
    id?: number;
    statType: string;
    statTime: Date;
    transferCntr: bigint;
    valueSum: bigint;
    minEpoch: number;
    maxEpoch: number;
}

export class DailyCfxTransferStat extends Model<IDailyCfxTransferStat> implements IDailyCfxTransferStat{
    id?: number;
    statType: string;
    statTime: Date;
    transferCntr: bigint;
    valueSum: bigint;
    minEpoch: number;
    maxEpoch: number;

    static register(sequelize) {
        DailyCfxTransferStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statType: {type: DataTypes.CHAR(2), allowNull: false, defaultValue: '1d'},
            statTime: {type: DataTypes.DATE, allowNull: false},
            transferCntr: {type: DataTypes.DECIMAL(60,0), allowNull: false, defaultValue: 0},
            valueSum: {type: DataTypes.DECIMAL(60,0), allowNull: false, defaultValue: 0},
            minEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            maxEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'stat_daily_cfx_transfer',
            timestamps: true,
            indexes: [{
                name: "idx_statType_statTime",
                fields: ["statType", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(dailyCfxTransferStat: DailyCfxTransferStat, dbTx = undefined): Promise<DailyCfxTransferStat> {
        return await DailyCfxTransferStat.create({
            statType: dailyCfxTransferStat.statType,
            statTime: dailyCfxTransferStat.statTime,
            transferCntr: dailyCfxTransferStat.transferCntr,
            valueSum: dailyCfxTransferStat.valueSum,
            minEpoch: dailyCfxTransferStat.minEpoch,
            maxEpoch: dailyCfxTransferStat.maxEpoch,
        }, {
            transaction: dbTx
        })
    }
}