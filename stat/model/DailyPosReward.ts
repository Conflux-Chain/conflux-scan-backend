import {DataTypes, Model} from "sequelize";

export interface IDailyPosRewardStat{
    id?: number,
    statTime: Date,
    statType: string,

    posReward: bigint,
    posRewardTotal: bigint,
}

export class DailyPosRewardStat extends Model<IDailyPosRewardStat> implements IDailyPosRewardStat{
    id?: number;
    statTime: Date;
    statType: string;

    posReward: bigint;
    posRewardTotal: bigint;

    static register(sequelize) {
        DailyPosRewardStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statTime: {type: DataTypes.DATE, allowNull: false},
            statType: {type: DataTypes.CHAR(2), allowNull: false, defaultValue: '1d'},

            posReward: {type: DataTypes.DECIMAL(65,18), allowNull: false, defaultValue: 0},
            posRewardTotal: {type: DataTypes.DECIMAL(65,18), allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'daily_pos_reward_stat',
            timestamps: true,
            indexes: [{
                name: "idx_statType_statTime",
                fields: ["statType", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(posRewardStat: DailyPosRewardStat, dbTx = undefined): Promise<IDailyPosRewardStat> {
        return await DailyPosRewardStat.create({
            statTime: posRewardStat.statTime,
            statType: posRewardStat.statType,

            posReward: posRewardStat.posReward,
            posRewardTotal: posRewardStat.posRewardTotal,
        }, {
            transaction: dbTx
        })
    }
}