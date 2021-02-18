import {Model,Sequelize,DataTypes} from "sequelize";

export interface IBalance{
    addressId: number
    balance:number
}
export const T_BALANCE = 'balance'
export class Balance extends Model<IBalance> implements IBalance{
    addressId: number
    balance:number
    static register(seq:Sequelize, clz, tableName) {
        // Balance.init({
        clz.init({
            addressId: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            balance: {type: DataTypes.DECIMAL(36,18), allowNull: false, defaultValue: 0},
        },{
            sequelize: seq,
            // timestamps: false,
            tableName: tableName,
        })
    }
}
export const T_DEX_CFX_BALANCE = 'dex_cfx_balance'
export class DexCfxBalance extends Balance{
    static register(seq){
        Balance.register(seq, DexCfxBalance, T_DEX_CFX_BALANCE)
    }
}