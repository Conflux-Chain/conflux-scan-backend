import {Sequelize, QueryTypes} from "sequelize";
import {Address, AddressInfo, ESpaceHex40Map, Hex40Map, hexMapInit} from "../model/HexMap";
import {Epoch} from "../model/Epoch";
import {PivotSwitch} from "../model/Block";
import {MinerBlock} from "../model/MinerBlock";
import {KV, Position} from "../model/KV";
import {TestTimezone} from "../model/TestTimezone";
import {Database} from "../config/StatConfig";
import {TopBatchIndex, TopRecord} from "../model/TopRecord";
import {DailyTransaction} from "../model/DailyTransaction";
import {DailyCfxHolder} from "../model/DailyCfxHolder";
import {TraceCreateContract, ContractDestroy} from "../model/TraceCreateContract";
import {TokenQuoteTrack} from "../model/TokenQuoteTrack";
import {DailyBlockDataStat} from "../model/DailyBlockDataStat";
import {
    CfxBalance, createTokenBalanceTable, NFTBalance,
} from "../model/Balance";
import {DailyToken, Erc1155Data, NftId, NftMint, Token} from "../model/Token";
import {ContractUser, createAddressErc20TransferTable, DailyTokenTxn, Erc20Transfer} from "../model/Erc20Transfer";
import {
    CfxTransfer,
    createAddressCfxTransferTable,
    DailyCfxTxn,
    CfxTransferRowMark, BakCfxTransfer,
} from "../model/CfxTransfer";
import {create721partition, Erc721Transfer} from "../model/Erc721Transfer";
// import {createAddressErc777TransferTable, Erc777Transfer} from "../model/Erc777Transfer";
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
import {ContractVerify, ProxyVerify} from "../model/ContractVerify";
import {TokenAutoDetect} from "../model/TokenAutoDetect";
import {TokenSecurityAudit} from "../model/TokenSecurityAudit";
import {StatApp} from "../StatApp";
import {StreamErrorLog} from "../model/ErrorLog";
import {Lock} from "../model/Lock";
import {createV2CfxBillTable, NegativeCfxBill} from "./watcher/DummyNode";
import {PruneInfo} from "../model/PruneInfo";
import {
    PosAccount,
    PosAccountBlock,
    PosBlock,
    PosCommittee,
    PosCommitteeNode, PosDailyStat, PosEpochRewardHash, PosGap,
    PosRegister, PosReward,
    PosTransaction
} from "../model/PoS";
import {EpochTask, UniqueAddress} from "./UniqueAddressStat";
import {TokenTransferStat} from "../model/TokenTransferStat";
import {AddrTransactionStat} from "../model/AddrTransactionStat";
import {AddrCfxTransferStat} from "../model/AddrCfxTransferStat";
import {DailyCfxTransferStat} from "../model/DailyCfxTransferStat";
import {DailyTokenTransferStat} from "../model/DailyTokenTransferStat";
import {MinerBlockStat} from "../model/MinerBlockStat";
import {EpochHashTokenTransfer, EpochTaskTokenTransfer} from "../TokenTransferSync";
import {Blacklist} from "../model/Blacklist";
import {CheckBlockInfo} from "../monitor/TxChecker";
import {CfxUser, EpochCfxTransferCount, EpochHashCfxTransfer, TaskCfxTransfer} from "../CfxTransferSync";
import {PosDailyStatMix} from "./pos/PosStat";
import {CrossSpaceStat} from "./CrossSpaceStat";
import {ENS, SearchText} from "./ens/EnsService";
import {ApiLog, checkApiLogIpField} from "../monitor/ApiLog";
import {TransferCount} from "../model/TransferCount";
import {PosRewardRank} from "./pos/PosRewardRank";
import {RateConfig, RateHit, RateKey} from "../router/RateLimiter";
import {createAddressTransferTable} from "../model/AddrTransfer";
import {createNftMetaPartition, NftMetaFts, NftMetaOld} from "./nftchecker/NftMetaStorage";
import {ApprovalRelation, TaskEpochApproval, TokenApproval} from "../ApprovalSync";
import {AddrEvent3525, Event3525, Slot3525, SlotChanged, TaskEvent3525, TokenSlot3525} from "../T3525Sync";
import {DailyNFTStat} from "../model/DailyNFTStat";
import {NFTMintStat} from "../model/NFTMintStat";
import {DailyNFTHolder} from "../model/DailyNFTHolder";
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
        console.log(`connect to DB fail:`, err)
        process.exit(9)
    });
    hexMapInit(sequelize);
    await Promise.all([
        createAddressErc20TransferTable(sequelize),
        create721partition(sequelize),
        createNftMetaPartition(sequelize),
        // createAddressErc777TransferTable(sequelize),
        createAddressErc1155TransferTable(sequelize),
        createAddressCfxTransferTable(sequelize),
        createFullMinerBlockTable(sequelize),
        createV2CfxBillTable(sequelize),
        createTokenBalanceTable(sequelize),
        createFullBlockTable(sequelize),
        createFullTransactionTable(sequelize),
        createAddressTxTable(sequelize),
        createAddressTransferTable(sequelize),
    ])
    NegativeCfxBill.register(sequelize)
    Position.register(sequelize)
    ENS.register(sequelize)
    ApiLog.register(sequelize)
    TransferCount.register(sequelize)
    Lock.register(sequelize)
    CfxTransferRowMark.register(sequelize)
    BlockRowMark.register(sequelize)
    TxnRowMark.register(sequelize)
    AbiInfo.register(sequelize)
    TokenApproval.register(sequelize)
    TaskEpochApproval.register(sequelize)
    ApprovalRelation.register(sequelize)
    Event3525.register(sequelize)
    AddrEvent3525.register(sequelize)
    Slot3525.register(sequelize)
    TokenSlot3525.register(sequelize)
    SlotChanged.register(sequelize)
    TaskEvent3525.register((sequelize))
    Erc20Transfer.register(sequelize)
    Erc721Transfer.register(sequelize)
    // Erc777Transfer.register(sequelize)
    Erc1155Transfer.register(sequelize)
    Erc1155Data.register(sequelize)
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
    ContractDestroy.register(sequelize)
    Token.register(sequelize);
    NftMint.register(sequelize)
    NftMetaOld.register(sequelize);
    NftMetaFts.register(sequelize);
    TokenQuoteTrack.register(sequelize);
    StreamErrorLog.register(sequelize)
    KV.register(sequelize);
    Epoch.register(sequelize);
    ContractVerify.register(sequelize);
    ProxyVerify.register(sequelize);
    DailyBlockDataStat.register(sequelize);
    CfxBalance.register(sequelize);
    TokenSecurityAudit.register(sequelize);
    PruneInfo.register(sequelize);
    TokenTransferStat.register(sequelize);
    AddrTransactionStat.register(sequelize);
    AddrCfxTransferStat.register(sequelize);
    DailyCfxTransferStat.register(sequelize);
    DailyTokenTransferStat.register(sequelize);
    MinerBlockStat.register(sequelize);
    Blacklist.register(sequelize);
    RateConfig.register(sequelize);
    RateKey.register(sequelize);
    RateHit.register(sequelize)
    ESpaceHex40Map.register(sequelize)
}
export async function initModel(sequelize) {
    await initPartialModel(sequelize)
    MinerBlock.register(sequelize);
    TopBatchIndex.register(sequelize)
    TopRecord.register(sequelize);
    Address.register(sequelize)
    AddressInfo.register(sequelize);
    NftId.register(sequelize)
    PivotSwitch.register(sequelize)
    TestTimezone.register(sequelize);
    CheckBlockInfo.register(sequelize)
    DailyTransaction.register(sequelize);
    DailyCfxHolder.register(sequelize);
    DailyContractCreate.register(sequelize);
    DailyContractStat.register(sequelize);
    DailyContractRegister.register(sequelize);
    DailyNFTStat.register(sequelize);
    DailyNFTHolder.register(sequelize);
    NFTBalance.register(sequelize);
    NFTMintStat.register(sequelize);
    EpochTask.register(sequelize);
    EpochTaskTokenTransfer.register(sequelize);
    EpochHashTokenTransfer.register(sequelize)
    ContractUser.register(sequelize);
    TaskCfxTransfer.register(sequelize);
    CfxUser.register(sequelize);
    EpochHashCfxTransfer.register(sequelize);
    EpochCfxTransferCount.register(sequelize);
    UniqueAddress.register(sequelize);
    CrossSpaceStat.register(sequelize)
    SearchText.register(sequelize)
    TokenAutoDetect.register(sequelize);
    PosBlock.register(sequelize);
    PosAccount.register(sequelize);
    PosAccountBlock.register(sequelize)
    PosCommittee.register(sequelize)
    PosCommitteeNode.register(sequelize)
    PosTransaction.register(sequelize)
    PosRegister.register(sequelize)
    PosEpochRewardHash.register(sequelize)
    PosReward.register(sequelize)
    PosRewardRank.register(sequelize)
    PosDailyStat.register(sequelize)
    PosDailyStatMix.register(sequelize)
    PosGap.register(sequelize)

    await checkApiLogIpField()
}

export function createMySql(dbConf) {
    console.log(`create mysql ${dbConf.instanceName}`)
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

    const seq = new Sequelize(dbConf.instanceName, null, null, dbConf);
    //autoAddPartition(seq).then()
    setInterval(()=>autoAddPartition(seq), 600_000)
    return seq
}


export async function autoAddPartition(seq:Sequelize) {
    const sql = `SELECT TABLE_SCHEMA,TABLE_NAME, min(convert(PARTITION_DESCRIPTION,unsigned)) as minV,
        max(convert(PARTITION_DESCRIPTION, UNSIGNED)) as maxV,
        count(*) as pCnt
       FROM INFORMATION_SCHEMA.PARTITIONS
       WHERE PARTITION_NAME is not null and TABLE_SCHEMA = '${conf.instanceName}' and PARTITION_METHOD = 'RANGE'
       group by TABLE_SCHEMA,TABLE_NAME
       `
    // find partition list
    const partitionList:any[] = await seq.query(sql, {type: QueryTypes.SELECT, raw: true})
    console.log(` partition table count ${partitionList.length}`)
    // check whether max partition contains records
    for (let partition of partitionList) {
        const hasBlankPartitionSql = `select TABLE_ROWS from INFORMATION_SCHEMA.PARTITIONS where TABLE_SCHEMA = '${conf.instanceName}'
        and TABLE_NAME = '${partition.TABLE_NAME}' and PARTITION_DESCRIPTION = ${partition.maxV} 
        and TABLE_ROWS = 0`
        const row = await seq.query(hasBlankPartitionSql, {type: QueryTypes.SELECT,
            // logging: console.log
        })
        if (row.length) {
            console.log(` table ${partition.TABLE_NAME} has a partition with zero records and range < ${partition.maxV}`)
            continue
        }
        const addSql = `alter table ${partition.TABLE_NAME
        } add partition (partition p${partition.pCnt+1} values less than (${partition.minV + partition.maxV}))`
        await seq.query(addSql, {type:QueryTypes.UPDATE, logging: console.log})
    }
}
