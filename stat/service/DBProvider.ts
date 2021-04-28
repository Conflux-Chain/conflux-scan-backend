import {Sequelize} from "sequelize";
import {Address, AddressInfo, Hex40Map, hexMapInit} from "../model/HexMap";
import {Epoch} from "../model/Epoch";
import {TransactionDB} from "../model/Transaction";
import {Block, PivotSwitch} from "../model/Block";
import {MinerBlock} from "../model/MinerBlock";
import {KV} from "../model/KV";
import {TestTimezone} from "../model/TestTimezone";
import {Database} from "../config/StatConfig";
import {TopBatchIndex, TopRecord} from "../model/TopRecord";
import {DailyTransaction} from "../model/DailyTransaction";
import {DailyCfxHolder} from "../model/DailyCfxHolder";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {
    Balance_cAMP,
    Balance_cBAND, Balance_cBNB,
    Balance_cBTC,
    Balance_cCOMP,
    Balance_cDAI,
    Balance_cDF, Balance_cDPI,
    Balance_cETH, Balance_CF, Balance_cFLUX,
    Balance_cFOR, Balance_CG, Balance_cHBTC, Balance_cITF, Balance_cKNC,
    Balance_cKP3R,
    Balance_cLEND,
    Balance_cLINK, Balance_cMBTM,
    Balance_cMOON, Balance_conDragon,
    Balance_CRCL_BTC_symbol,
    Balance_cSNX, Balance_csUSD,
    Balance_cSWRV,
    Balance_cUMA,
    Balance_cUSDC,
    Balance_cYFI,
    Balance_cYFII,
    Balance_FC, Balance_MNNFT, Balance_TD, Balance_TREA,
    CfxBalance,
    DexCfxBalance,
    DexUSDTBalance,
    USDTBalance,
    WCfxBalance
} from "../model/Balance";
import {Trace} from "../model/Trace";
import {NftId, Token} from "../model/Token";
import {DailyTokenTxn, Erc20Transfer} from "../model/Erc20Transfer";
import {CfxTransfer, DailyCfxTxn} from "../model/CfxTransfer";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc777Transfer} from "../model/Erc777Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {AddressStat, DailyActiveAddress} from "../model/StatAddress";
import {ContractInfo} from "../model/ContractInfo";
import {AddressTransactionIndex, FullBlock, FullTransaction} from "../model/FullBlock";
let conf
export function createDB(config) {
    conf = config
    if (isMySQL()) {
        return createMySql(config)
    }
    let storage = config.sqlitePath || './data/database.sqlite';
    const sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: storage,
        logging: config.logging || false,
    });
    console.info(`create sqlite: ${storage}`)
    return sequelize
}

export function getDBConf() : Database{
    return conf;
}

/**
 * sqlite sum() specification: https://sqlite.org/lang_aggfunc.html
 * Use total() instead of sum() to avoid `integer overflow`.
 */
export function getSumFunction() : string{
    // sqlite uses `total`
    return isMySQL() ? 'SUM' : 'TOTAL'
}
export function isMySQL() : boolean {
    return conf.USE_MYSQL === true
}

// init for scan-backend
export async function initPartialModel(sequelize) {
    await sequelize.authenticate().then(()=>{
        console.log('DB authenticated.')
    }).catch(err=>{
        console.log(`connect to DB fail`, err)
    });
    hexMapInit(sequelize);
    Erc20Transfer.register(sequelize)
    Erc721Transfer.register(sequelize)
    Erc777Transfer.register(sequelize)
    Erc1155Transfer.register(sequelize)
    DailyTokenTxn.register(sequelize)
    CfxTransfer.register(sequelize)
    DailyCfxTxn.register(sequelize)
    DailyActiveAddress.register(sequelize)
    // remove auto generated PK field since we use epoch-position as PK.
    FullBlock.register(sequelize);  FullBlock.removeAttribute('id')
    FullTransaction.register(sequelize);  FullTransaction.removeAttribute('id')
    AddressTransactionIndex.register(sequelize);  AddressTransactionIndex.removeAttribute('id')
    AddressStat.register(sequelize)
    ContractInfo.register(sequelize)
    Hex40Map.register(sequelize)
    TraceCreateContract.register(sequelize)
}
export async function initModel(sequelize) {
    await initPartialModel(sequelize)
    Epoch.register(sequelize);
    TransactionDB.register(sequelize);
    Block.register(sequelize);
    MinerBlock.register(sequelize);
    KV.register(sequelize);
    TopBatchIndex.register(sequelize)
    TopRecord.register(sequelize);
    Address.register(sequelize)
    AddressInfo.register(sequelize);

    DexCfxBalance.register(sequelize)
    WCfxBalance.register(sequelize)
    USDTBalance.register(sequelize)
    DexUSDTBalance.register(sequelize)
    CfxBalance.register(sequelize)

    Balance_CRCL_BTC_symbol.register(sequelize);
    Balance_cMOON.register(sequelize);
    // BalancecUSDT.register(sequelize);
    Balance_cETH.register(sequelize);
    Balance_FC.register(sequelize);
    // BalanceWCFX.register(sequelize);
    Balance_cDAI.register(sequelize);
    Balance_cUSDC.register(sequelize);
    Balance_cLEND.register(sequelize);
    Balance_cFOR.register(sequelize);
    Balance_cLINK.register(sequelize);
    Balance_cCOMP.register(sequelize);
    Balance_cBAND.register(sequelize);
    Balance_cBTC.register(sequelize);
    Balance_cYFI.register(sequelize);
    Balance_cDF.register(sequelize);
    Balance_cYFII.register(sequelize);
    Balance_cSWRV.register(sequelize);
    Balance_cKP3R.register(sequelize);
    Balance_cUMA.register(sequelize);
    Balance_cKNC.register(sequelize);
    Balance_cSNX.register(sequelize);
    Balance_csUSD.register(sequelize);
    Balance_MNNFT.register(sequelize);
    Balance_cITF.register(sequelize);
    Balance_cAMP.register(sequelize);
    Balance_cDPI.register(sequelize);
    Balance_cBNB.register(sequelize);
    Balance_cMBTM.register(sequelize);
    Balance_cHBTC.register(sequelize);
    Balance_TREA.register(sequelize);


    // erc1155
    Balance_conDragon.register(sequelize);
    Balance_CF.register(sequelize);
    Balance_CG.register(sequelize);
    Balance_TD.register(sequelize);
    Balance_cFLUX.register(sequelize);

    Token.register(sequelize);
    NftId.register(sequelize)
    Trace.register(sequelize)
    PivotSwitch.register(sequelize)
    TestTimezone.register(sequelize);
    DailyTransaction.register(sequelize);
    DailyCfxHolder.register(sequelize);
}

export function createMySql(dbConf) {
    console.log(`create mysql ${dbConf.host}`)
    return new Sequelize(dbConf.database,
        dbConf.user,
        dbConf.pwd, {
        host: dbConf.host, port: dbConf.port,
        dialect: 'mysql', /* one of 'mysql' | 'mariadb' | 'postgres' | 'mssql' */
        // logging: console.log,            // default true
            logging: false,
        // timezone: '+08:00', // default UTC
        // dialectOptions: {
        //   useUTC: false,
        // },
    });
}