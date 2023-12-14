import {DataTypes, Model} from "sequelize";

export interface IDailyCfxHolder{
    id?: number,
    statDay: Date,
    statType: string,
    holderCount: number
}

export class DailyCfxHolder extends Model<IDailyCfxHolder> implements IDailyCfxHolder{
    id?: number;
    statDay: Date;
    statType: string;
    holderCount: number;
    static register(sequelize) {
        DailyCfxHolder.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statDay: {type: DataTypes.DATE, allowNull: false},
            statType: {type: DataTypes.CHAR(3), allowNull: false, defaultValue: '1d'},
            holderCount: {type: DataTypes.BIGINT, allowNull: false},
        },{
            sequelize: sequelize,
            tableName: 'cfx_holder_daily',
            timestamps: true,
            indexes: [{
                name: "idx_statType_statDay",
                fields: ["statType", "statDay"],
                unique: true,
            }]
        })
    }

    static async add(dailyCfxHolder: DailyCfxHolder, dbTx = undefined): Promise<DailyCfxHolder> {
        return await DailyCfxHolder.create({
            statDay: dailyCfxHolder.statDay,
            statType: dailyCfxHolder.statType,
            holderCount: dailyCfxHolder.holderCount
        }, {
            transaction: dbTx
        })
    }
}