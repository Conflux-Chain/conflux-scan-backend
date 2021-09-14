import {QueryTypes, Sequelize} from "sequelize";
import {Address, AddressInfo, Hex40Map, hexMapInit} from "../model/HexMap";
import {Epoch} from "../model/Epoch";
import {TransactionDB} from "../model/Transaction";
import {Block, PivotSwitch} from "../model/Block";
import {MinerBlock} from "../model/MinerBlock";
import {KV, Position} from "../model/KV";
import {TestTimezone} from "../model/TestTimezone";
import {Database} from "../config/StatConfig";
import {TopBatchIndex, TopRecord} from "../model/TopRecord";
import {DailyTransaction} from "../model/DailyTransaction";
import {DailyCfxHolder} from "../model/DailyCfxHolder";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {TokenQuoteTrack} from "../model/TokenQuoteTrack";
import {DailyBlockDataStat} from "../model/DailyBlockDataStat";
import {
    Balance_ACGNFT,
    Balance_ARTT,
    Balance_cAMP,
    Balance_cBAND,
    Balance_cBNB,
    Balance_cBTC,
    Balance_cCOMP,
    Balance_cDAI,
    Balance_cDF,
    Balance_cDPI,
    Balance_cETH,
    Balance_CF,
    Balance_cFLUX,
    Balance_cFOR,
    Balance_CG,
    Balance_cHBTC,
    Balance_cITF,
    Balance_cKNC,
    Balance_cKP3R,
    Balance_cLEND,
    Balance_cLINK,
    Balance_cMBTM,
    Balance_cMOON,
    Balance_cOKT,
    Balance_conDragon,
    Balance_CRCL_BTC_symbol,
    Balance_cSNX,
    Balance_csUSD,
    Balance_cSWRV,
    Balance_CTN,
    Balance_cUMA,
    Balance_cUSDC,
    Balance_cYFI,
    Balance_cYFII, Balance_DAN,
    Balance_EPIK_NFT,
    Balance_FC,
    Balance_K,
    Balance_MNNFT,
    Balance_PHM_NFT,
    Balance_POOLGO,
    Balance_POS,
    Balance_TD,
    Balance_TREA,
    Balance_YAO,
    CfxBalance, createTokenBalanceTable,
    DexCfxBalance,
    DexUSDTBalance,
    USDTBalance,
    WCfxBalance
} from "../model/Balance";
import {DailyToken, NftId, NftMint, Token} from "../model/Token";
import {createAddressErc20TransferTable, DailyTokenTxn, Erc20Transfer} from "../model/Erc20Transfer";
import {
    CfxTransfer,
    createAddressCfxTransferTable,
    DailyCfxTxn,
    CfxTransferRowMark, BakCfxTransfer,
} from "../model/CfxTransfer";
import {create721partition, Erc721Transfer} from "../model/Erc721Transfer";
import {createAddressErc777TransferTable, Erc777Transfer} from "../model/Erc777Transfer";
import {createAddressErc1155TransferTable, Erc1155Transfer} from "../model/Erc1155Transfer";
import {AddressStat, DailyActiveAddress} from "../model/StatAddress";
import {AbiInfo, ContractInfo} from "../model/ContractInfo";
import {Contract} from "../model/Contract";
import {
    BlockRowMark, createAddressTxTable, createFullBlockTable, createFullTransactionTable,
    FailedTx,
    TxnRowMark
} from "../model/FullBlock";
import {DailyContractCreate} from "../model/DailyContractCreate";
import {DailyContractStat} from "../model/DailyContractStat";
import {createFullMinerBlockTable} from "../model/FullMinerBlock";
import {DailyContractRegister} from "../model/DailyContractRegister";
import {ContractVerify} from "../model/ContractVerify";
import {TokenAutoDetect} from "../model/TokenAutoDetect";
import {TokenSecurityAudit} from "../model/TokenSecurityAudit";
import {StatApp} from "../StatApp";
import {StreamErrorLog} from "../model/ErrorLog";
import {Lock} from "../model/Lock";
import {CfxBill, createV2CfxBillTable, NegativeCfxBill} from "./watcher/DummyNode";
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
export async function createTable(seq:Sequelize, sql:string) {
    return new Promise(async r=>{
        if (StatApp.readonly) {
            r(1)
        } else {
            await seq.query(sql,{
                type:QueryTypes.UPDATE
            }).then(()=>r(1))
        }
    })
}
// init for scan-backend
export async function initPartialModel(sequelize) {
    await sequelize.authenticate().then(()=>{
        console.log('DB authenticated.')
    }).catch(err=>{
        console.log(`connect to DB fail`, err)
    });
    hexMapInit(sequelize);
    await Promise.all([
        createAddressErc20TransferTable(sequelize),
        create721partition(sequelize),
        createAddressErc777TransferTable(sequelize),
        createAddressErc1155TransferTable(sequelize),
        createAddressCfxTransferTable(sequelize),
        createFullMinerBlockTable(sequelize),
        createV2CfxBillTable(sequelize),
        createTokenBalanceTable(sequelize),
        createFullBlockTable(sequelize),
        createFullTransactionTable(sequelize),
        createAddressTxTable(sequelize),
    ])
    NegativeCfxBill.register(sequelize)
    Position.register(sequelize)
    Lock.register(sequelize)
    CfxTransferRowMark.register(sequelize)
    BlockRowMark.register(sequelize)
    TxnRowMark.register(sequelize)
    AbiInfo.register(sequelize)
    Erc20Transfer.register(sequelize)
    Erc721Transfer.register(sequelize)
    Erc777Transfer.register(sequelize)
    Erc1155Transfer.register(sequelize)
    DailyTokenTxn.register(sequelize)
    CfxTransfer.register(sequelize)
    BakCfxTransfer.register(sequelize)
    DailyCfxTxn.register(sequelize)
    DailyActiveAddress.register(sequelize)
    DailyToken.register(sequelize)
    FailedTx.register(sequelize)
    AddressStat.register(sequelize)
    ContractInfo.register(sequelize)
    Contract.register(sequelize)
    Hex40Map.register(sequelize)
    TraceCreateContract.register(sequelize)
    Token.register(sequelize);
    NftMint.register(sequelize)
    TokenQuoteTrack.register(sequelize);
    StreamErrorLog.register(sequelize)
    KV.register(sequelize);
    Epoch.register(sequelize);
    ContractVerify.register(sequelize);
    DailyBlockDataStat.register(sequelize);
    CfxBalance.register(sequelize);
    TokenSecurityAudit.register(sequelize);
}
export async function initModel(sequelize) {
    await initPartialModel(sequelize)
    TransactionDB.register(sequelize);
    Block.register(sequelize);
    MinerBlock.register(sequelize);
    TopBatchIndex.register(sequelize)
    TopRecord.register(sequelize);
    Address.register(sequelize)
    AddressInfo.register(sequelize);

    DexCfxBalance.register(sequelize)
    WCfxBalance.register(sequelize)
    USDTBalance.register(sequelize)
    DexUSDTBalance.register(sequelize)

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
    Balance_YAO.register(sequelize);
    Balance_cOKT.register(sequelize);
    Balance_K.register(sequelize);
    Balance_ACGNFT.register(sequelize);
    Balance_EPIK_NFT.register(sequelize);
    Balance_POOLGO.register(sequelize);
    Balance_POS.register(sequelize);
    Balance_ARTT.register(sequelize);

    // erc1155
    Balance_conDragon.register(sequelize);
    Balance_CF.register(sequelize);
    Balance_CG.register(sequelize);
    Balance_TD.register(sequelize);
    Balance_cFLUX.register(sequelize);
    Balance_CTN.register(sequelize);
    Balance_PHM_NFT.register(sequelize);
    Balance_DAN.register(sequelize);

    NftId.register(sequelize)
    PivotSwitch.register(sequelize)
    TestTimezone.register(sequelize);
    DailyTransaction.register(sequelize);
    DailyCfxHolder.register(sequelize);
    DailyContractCreate.register(sequelize);
    DailyContractStat.register(sequelize);
    DailyContractRegister.register(sequelize);
    TokenAutoDetect.register(sequelize);
}

export function createMySql(dbConf) {
    console.log(`create mysql ${dbConf.host}`)
    // return new Sequelize(dbConf.database,
    //     dbConf.user,
    //     dbConf.pwd, {
    //     host: dbConf.host, port: dbConf.port,
    //     dialect: 'mysql', /* one of 'mysql' | 'mariadb' | 'postgres' | 'mssql' */
    //     // logging: console.log,            // default true
    //         logging: false,
    //     // timezone: '+08:00', // default UTC
    //     // dialectOptions: {
    //     //   useUTC: false,
    //     // },
    // });

    return new Sequelize(dbConf.instanceName, null, null, dbConf);
}
