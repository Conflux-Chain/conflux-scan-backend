import {DataTypes, Model} from "sequelize";

export interface IDailyNFTHolder{
    id?: number,
    statTime: Date,
    statType: string,
    holderCount721: number
    holderCount1155: number
    holderCount: number
}

export class DailyNFTHolder extends Model<IDailyNFTHolder> implements IDailyNFTHolder{
    id?: number;
    statTime: Date;
    statType: string;
    holderCount721: number;
    holderCount1155: number;
    holderCount: number;
    static register(sequelize) {
        DailyNFTHolder.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statTime: {type: DataTypes.DATE, allowNull: false},
            statType: {type: DataTypes.CHAR(3), allowNull: false, defaultValue: '1d'},
            holderCount721: {type: DataTypes.BIGINT, allowNull: false},
            holderCount1155: {type: DataTypes.BIGINT, allowNull: false},
            holderCount: {type: DataTypes.BIGINT, allowNull: false},
        },{
            sequelize: sequelize,
            tableName: 'daily_nft_holder',
            timestamps: true,
            indexes: [{
                name: "idx_statType_statTime",
                fields: ["statType", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(dailyNFTHolder: DailyNFTHolder, dbTx = undefined): Promise<DailyNFTHolder> {
        return await DailyNFTHolder.create({
            statTime: dailyNFTHolder.statTime,
            statType: dailyNFTHolder.statType,
            holderCount721: dailyNFTHolder.holderCount721,
            holderCount1155: dailyNFTHolder.holderCount1155,
            holderCount: dailyNFTHolder.holderCount,
        }, {
            transaction: dbTx
        })
    }
}