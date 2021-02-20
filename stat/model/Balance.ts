import {Model,Sequelize,DataTypes} from "sequelize";

export interface IBalance{
    addressId: number
    balance:number
}
const registeredTable = new Set<{}>()
export const T_BALANCE = 'balance'
export class Balance extends Model<IBalance> implements IBalance{
    addressId: number
    balance:number
    static register(seq:Sequelize, clz, tableName) {
        // Balance.init({
        if (registeredTable.has(clz)) {
            throw new Error('Class already registered:'+clz)
        }
        registeredTable.add(clz)
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
export const T_WCFX_BALANCE = 'wcfx_balance'
export class WCfxBalance extends Balance{
    static register(seq){
        Balance.register(seq, WCfxBalance, T_WCFX_BALANCE)
    }
}
export const T_USDT_BALANCE = 'usdt_balance'
export class USDTBalance extends Balance{
    static register(seq){
        Balance.register(seq, USDTBalance, T_USDT_BALANCE)
    }
}
export const T_DEX_USDT_BALANCE = 'dex_usdt_balance'
export class DexUSDTBalance extends Balance{
    static register(seq){
        Balance.register(seq, DexUSDTBalance, T_DEX_USDT_BALANCE)
    }
}
export const T_CFX_BALANCE = 'cfx_balance'
export interface ICfxBalance extends IBalance{
    stakingBalance:number
    total:number
}
export class CfxBalance extends Model<ICfxBalance> implements ICfxBalance{
    addressId: number
    balance:number
    stakingBalance:number
    total:number
    static register(seq){
        CfxBalance.init({
            addressId: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            balance: {type: DataTypes.DECIMAL(36,18), allowNull: false, defaultValue: 0},
            stakingBalance: {type: DataTypes.DECIMAL(36,18), allowNull: false, defaultValue: 0},
            total: {type: DataTypes.DECIMAL(36,18), allowNull: false, defaultValue: 0},
        },{
            sequelize: seq,
            // timestamps: false,
            tableName: T_CFX_BALANCE,
        })
    }
}