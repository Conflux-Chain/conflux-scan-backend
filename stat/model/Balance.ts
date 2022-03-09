import {Model,Sequelize,DataTypes} from "sequelize";
import {createTable} from "../service/DBProvider";
// table for multiple token
export interface ITokenBalance {
    contractId: number
    addressId: number
    balance:bigint
}
export class TokenBalance extends Model<ITokenBalance> implements ITokenBalance {
    contractId: number
    addressId: number
    balance:bigint
    static register(seq:Sequelize) {
        TokenBalance.init({
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            addressId: {type: DataTypes.BIGINT, allowNull: false},
            balance: {type: DataTypes.STRING(78), allowNull: false},
        }, {
            sequelize: seq, tableName: 'token_balance'
        })
    }
}
const sql_TokenBalance = `
create table if not exists token_balance
(
    contractId  bigint not null,
    addressId  bigint not null,
    balance varchar(78) not null,
    createdAt datetime not null,
    updatedAt datetime not null,
    primary key contract_address_id (contractId, addressId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
partition by hash (contractId)
   PARTITIONS 97;
`
export async function createTokenBalanceTable(seq) {
    return createTable(seq, sql_TokenBalance).then(()=>{
        TokenBalance.register(seq)
    }).then(()=>{
        TokenBalance.removeAttribute('id')
    })
}
// =============================
// table for each token
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
            addressId: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true},
            balance: {type: DataTypes.DECIMAL(36,18), allowNull: false, defaultValue: 0},
        },{
            sequelize: seq,
            // timestamps: false,
            tableName: tableName,
        })
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
//