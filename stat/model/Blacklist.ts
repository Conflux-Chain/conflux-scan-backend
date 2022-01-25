import {DataTypes, Model} from "sequelize";

export interface IBlacklist{
    id?: number;
    address: string;
    remark: string;
}

export class Blacklist extends Model<IBlacklist> implements IBlacklist{
    id?: number;
    address: string;
    remark: string;

    static register(sequelize) {
        Blacklist.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            address: {type: DataTypes.CHAR(64), allowNull: false, unique: true},
            remark: {type: DataTypes.CHAR(64), allowNull: true},
        },{
            sequelize: sequelize,
            tableName: 'blacklist',
            timestamps: true,
        })
    }

    static async add(blacklist: Blacklist, dbTx = undefined): Promise<Blacklist> {
        return await Blacklist.create({
            address: blacklist.address,
            remark: blacklist.remark,
        }, {
            transaction: dbTx
        })
    }
}