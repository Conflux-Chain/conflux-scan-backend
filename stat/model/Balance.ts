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
//
export class Balance_CRCL_BTC_symbol extends Balance{
    static register(seq){
        Balance.register(seq, Balance_CRCL_BTC_symbol, 'balance_CRCL_BTC_symbol')
    }
}
export class Balance_cMOON extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cMOON, 'balance_cMOON')
    }
}
export class Balance_cUSDT extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cUSDT, 'balance_cUSDT')
    }
}
export class Balance_cETH extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cETH, 'balance_cETH')
    }
}
export class Balance_FC extends Balance{
    static register(seq){
        Balance.register(seq, Balance_FC, 'balance_FC')
    }
}
export class Balance_WCFX extends Balance{
    static register(seq){
        Balance.register(seq, Balance_WCFX, 'balance_WCFX')
    }
}
export class Balance_cDAI extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cDAI, 'balance_cDAI')
    }
}
export class Balance_cUSDC extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cUSDC, 'balance_cUSDC')
    }
}
export class Balance_cLEND extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cLEND, 'balance_cLEND')
    }
}
export class Balance_cFOR extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cFOR, 'balance_cFOR')
    }
}
export class Balance_cLINK extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cLINK, 'balance_cLINK')
    }
}
export class Balance_cCOMP extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cCOMP, 'balance_cCOMP')
    }
}
export class Balance_cBAND extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cBAND, 'balance_cBAND')
    }
}
export class Balance_cBTC extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cBTC, 'balance_cBTC')
    }
}
export class Balance_cYFI extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cYFI, 'balance_cYFI')
    }
}
export class Balance_cDF extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cDF, 'balance_cDF')
    }
}
export class Balance_cYFII extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cYFII, 'balance_cYFII')
    }
}
export class Balance_cSWRV extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cSWRV, 'balance_cSWRV')
    }
}
export class Balance_cKP3R extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cKP3R, 'balance_cKP3R')
    }
}
export class Balance_cUMA extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cUMA, 'balance_cUMA')
    }
}
export class Balance_cKNC extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cKNC, 'balance_cKNC')
    }
}
export class Balance_cSNX extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cSNX, 'balance_cSNX')
    }
}
export class Balance_csUSD extends Balance{
    static register(seq){
        Balance.register(seq, Balance_csUSD, 'balance_csUSD')
    }
}
export class Balance_MNNFT extends Balance{
    static register(seq){
        Balance.register(seq, Balance_MNNFT, 'balance_MNNFT')
    }
}
export class Balance_cITF extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cITF, 'balance_cITF')
    }
}

export class Balance_conDragon extends Balance{
    static register(seq){
        Balance.register(seq, Balance_conDragon, 'balance_conDragon')
    }
}
export class Balance_CF extends Balance{
    static register(seq){
        Balance.register(seq, Balance_CF, 'balance_CF')
    }
}
export class Balance_CG extends Balance{
    static register(seq){
        Balance.register(seq, Balance_CG, 'balance_CG')
    }
}
export class Balance_cAMP extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cAMP, 'balance_cAMP')
    }
}
export class Balance_cDPI extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cDPI, 'balance_cDPI')
    }
}
export class Balance_TD extends Balance{
    static register(seq){
        Balance.register(seq, Balance_TD, 'balance_TD')
    }
}
export class Balance_cFLUX extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cFLUX, 'balance_cFLUX')
    }
}

export class Balance_cBNB extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cBNB, 'balance_cBNB')
    }
}
export class Balance_cMBTM extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cMBTM, 'balance_cMBTM')
    }
}

export class Balance_cHBTC extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cHBTC, 'balance_cHBTC')
    }
}
export class Balance_TREA extends Balance{
    static register(seq){
        Balance.register(seq, Balance_TREA, 'balance_TREA')
    }
}
export class Balance_YAO extends Balance{
    static register(seq){
        Balance.register(seq, Balance_YAO, 'balance_YAO')
    }
}
export class Balance_cOKT extends Balance{
    static register(seq){
        Balance.register(seq, Balance_cOKT, 'balance_cOKT')
    }
}
// It's a test token in testnet.
export class Balance_K extends Balance{
    static register(seq){
        Balance.register(seq, Balance_K, 'balance_K')
    }
}
// test model end.

export class Balance_ACGNFT extends Balance{
    static register(seq){
        Balance.register(seq, Balance_ACGNFT, 'balance_ACGNFT')
    }
}
export class Balance_EPIK_NFT extends Balance{
static register(seq){
        Balance.register(seq, Balance_EPIK_NFT, 'balance_EPIK_NFT')
    }
}

export class Balance_POOLGO extends Balance{
    static register(seq){
        Balance.register(seq, Balance_POOLGO, 'balance_POOLGO')
    }
}
export class Balance_POS extends Balance{
    static register(seq){
        Balance.register(seq, Balance_POS, 'balance_POS')
    }
}
export class Balance_ARTT extends Balance{
    static register(seq){
        Balance.register(seq, Balance_ARTT, 'balance_ARTT')
    }
}
export class Balance_CTN extends Balance{
    static register(seq){
        Balance.register(seq, Balance_CTN, 'balance_CTN')
    }
}
export class Balance_PHM_NFT extends Balance{
static register(seq){
        Balance.register(seq, Balance_PHM_NFT, 'balance_PHM_NFT')
    }
}
export class Balance_DAN extends Balance{
    static register(seq){
        Balance.register(seq, Balance_DAN, 'balance_DAN')
    }
}
