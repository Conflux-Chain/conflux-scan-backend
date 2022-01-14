import {DataTypes, Model} from "sequelize";

export interface IDailyTokenTransferStat{
    id?: number;
    statType: string;
    statTime: Date;
    transferCntr: bigint;
    minEpoch: number;
    maxEpoch: number;
}

export class DailyTokenTransferStat extends Model<IDailyTokenTransferStat> implements IDailyTokenTransferStat{
    id?: number;
    statType: string;
    statTime: Date;
    transferCntr: bigint;
    minEpoch: number;
    maxEpoch: number;

    static register(sequelize) {
        DailyTokenTransferStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statType: {type: DataTypes.CHAR(2), allowNull: false, defaultValue: '1d'},
            statTime: {type: DataTypes.DATE, allowNull: false},
            transferCntr: {type: DataTypes.DECIMAL(60,0), allowNull: false, defaultValue: 0},
            minEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            maxEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'stat_daily_token_transfer',
            timestamps: true,
            indexes: [{
                name: "idx_statType_statTime",
                fields: ["statType", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(dailyTokenTransferStat: DailyTokenTransferStat, dbTx = undefined): Promise<DailyTokenTransferStat> {
        return await DailyTokenTransferStat.create({
            statType: dailyTokenTransferStat.statType,
            statTime: dailyTokenTransferStat.statTime,
            transferCntr: dailyTokenTransferStat.transferCntr,
            minEpoch: dailyTokenTransferStat.minEpoch,
            maxEpoch: dailyTokenTransferStat.maxEpoch,
        }, {
            transaction: dbTx
        })
    }
}