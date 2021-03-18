import {DataTypes, Model} from "sequelize";

export interface IDailyCfxHolder{
    id?: number,
    statDay: string,
    holderCount: number
}

export class DailyCfxHolder extends Model<IDailyCfxHolder> implements IDailyCfxHolder{
    id?: number;
    statDay: string;
    holderCount: number;
    static register(sequelize) {
        DailyCfxHolder.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statDay: {type: DataTypes.CHAR(8), allowNull: false},
            holderCount: {type: DataTypes.BIGINT, allowNull: false},
        },{
            sequelize: sequelize,
            tableName: 'cfx_holder_daily',
            timestamps: true,
            indexes: [{
                name: "statDay_idx",
                fields: ["statDay"],
                unique: true,
            }]
        })
    }

    static async add(dailyCfxHolder: DailyCfxHolder, dbTx = undefined): Promise<DailyCfxHolder> {
        return await DailyCfxHolder.create({
            statDay: dailyCfxHolder.statDay,
            holderCount: dailyCfxHolder.holderCount
        }, {
            transaction: dbTx
        })
    }
}