import {DataType, DataTypes, IndexesOptions, QueryInterface, QueryTypes, Sequelize} from "sequelize";
import {ESpaceHex40Map, Hex40Map} from "../model/HexMap";
import {Epoch, VoteParams} from "../model/Epoch";
import {PivotSwitch} from "../model/Block";
import {MinerBlock} from "../model/MinerBlock";
import {KV} from "../model/KV";
import {Database, NoCoreSpace} from "../config/StatConfig";
import {DailyTransaction} from "../model/DailyTransaction";
import {DailyCfxHolder} from "../model/DailyCfxHolder";
import {ContractDestroy, TraceCreateContract} from "../model/TraceCreateContract";
import {TokenQuoteTrack} from "../model/TokenQuoteTrack";
import {DailyBlockDataStat} from "../model/DailyBlockDataStat";
import {CfxBalance, createTokenBalanceTable, NFTBalance,} from "../model/Balance";
import {DailyToken, Erc1155Amount, Erc1155Data, NftId, NftMint, Token} from "../model/Token";
import {ContractUser, createAddressErc20TransferTable, DailyTokenTxn, Erc20Transfer} from "../model/Erc20Transfer";
import {CfxTransfer, CfxTransferRowMark, createAddressCfxTransferTable, DailyCfxTxn,} from "../model/CfxTransfer";
import {create721partition, Erc721Transfer} from "../model/Erc721Transfer";
import {createAddressErc1155TransferTable, Erc1155Transfer} from "../model/Erc1155Transfer";
import {AddressStat, DailyActiveAddress} from "../model/StatAddress";
import {AbiInfo, ContractABI, FormatWithArgMaxLength} from "../model/ContractInfo";
import {addNameSymbolFailureColumn, Contract} from "../model/Contract";
import {
    BlockRowMark,
    createAddressTxTable,
    createFullBlockExtTable,
    createFullBlockTable,
    createFullTransactionTable,
    FailedTx,
    TxnRowMark
} from "../model/FullBlock";
import {DailyContractCreate, DailyContractRegister, DailyContractStat} from "../model/DailyContractStat";
import {createFullMinerBlockTable} from "../model/FullMinerBlock";
import {ProxyVerify} from "../model/Contract";
import {TokenSecurityAudit} from "../model/TokenSecurityAudit";
import {StatApp} from "../StatApp";
import {Lock} from "../model/Lock";
import {PruneInfo} from "../model/PruneInfo";
import {
    PosAccount,
    PosAccountBlock,
    PosBlock,
    PosCommittee,
    PosCommitteeNode,
    PosDailyStat,
    PosEpochRewardHash,
    PosGap,
    PosRegister,
    PosReward,
    PosTransaction
} from "../model/PoS";
import {EpochTask, UniqueAddress} from "./UniqueAddressStat";
import {EpochHashTokenTransfer,} from "../TokenTransferSync";
import {Blacklist} from "../model/Blacklist";
import {CheckBlockInfo} from "../monitor/TxChecker";
import {CfxUser, EpochHashCfxTransfer} from "../CfxTransferSync";
import {PosDailyStatMix} from "./pos/PosStat";
import {CrossSpaceStat} from "./CrossSpaceStat";
import {ApiLog} from "../monitor/ApiLog";
import {NFTOwnerCount, TransferCount} from "../model/TransferCount";
import {PosRewardRank} from "./pos/PosRewardRank";
import {RateConfig, RateHit, RateKey} from "../router/RateLimiter";
import {createAddressTransferTable, EpochAddressIds} from "../model/AddrTransfer";
import {createNftMetaPartition, NftMetaFts} from "./nftchecker/NftMetaStorage";
import {ApprovalRelation, TaskEpochApproval, TokenApproval} from "../ApprovalSync";
import {AddrEvent3525, Event3525, Slot3525, SlotChanged, TaskEvent3525, TokenSlot3525} from "../T3525Sync";
import {DailyNFTHolder, DailyNFTStat} from "../model/DailyNFTStat";
import {CensorItem} from "../model/CensorItem";
import {createAddressNftTransferTable, NftTransfer} from "../model/NftTransfer";
import {DailyPosRewardStat, DailyPowRewardStat} from "../model/DailyReward";
import {NameTag} from "../model/NameTag";
import {HeartBeatBean} from "../model/HeartBeat";
import {DailyBurntFeeStat} from "../model/DailyBurntFeeStat";
import {GasConsumer} from "../model/GasConsumer";
import {ReqAccount} from "./watcher/AccountChecker";
import {ErrorLog} from "../monitor/ErrorMonitor";
import {AddressNfts} from "../model/AddrNft";
import {sleep} from "./tool/ProcessTool";
import {UniqueAddressDaily, UniqueAddressHourly} from "../model/UniqueAddr";
import {ResultCache} from "../model/ResultCache";
import {TxReceiverDaily, TxReceiverHourly, TxSenderDaily, TxSenderHourly} from "../PeriodTxnSummary";
import {AuthAction, AuthBlockStub} from "../model/EIP7702model";
import {ContractImpl} from "../model/ContractImpl";
import {VerifiedContracts} from "../model/VerifiedContracts";
import {initBlockWithdrawModel} from "../model/ZG";
import {DailyGasStat} from "../model/DailyGasStat";

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
    return conf.useMysql === true
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
        return sleep(10_000).then(()=>{
            process.exit(9)
        })
    });
    await Promise.all([
        createAddressErc20TransferTable(sequelize),
        create721partition(sequelize),
        createNftMetaPartition(sequelize),
        // createAddressErc777TransferTable(sequelize),
        createAddressErc1155TransferTable(sequelize),
        createAddressCfxTransferTable(sequelize),
        createFullMinerBlockTable(sequelize),
        // createV2CfxBillTable(sequelize),
        createTokenBalanceTable(sequelize),
        createFullBlockTable(sequelize),
        createFullTransactionTable(sequelize),
        createAddressTxTable(sequelize),
        createAddressTransferTable(sequelize),
        createAddressNftTransferTable(sequelize),
        createFullBlockExtTable(sequelize),
    ])
    ApiLog.register(sequelize)
    ReqAccount.register(sequelize)
    ErrorLog.register(sequelize)
    TransferCount.register(sequelize)
    NFTOwnerCount.register(sequelize)
    Lock.register(sequelize)
    CfxTransferRowMark.register(sequelize)
    BlockRowMark.register(sequelize)
    TxnRowMark.register(sequelize)
    AbiInfo.register(sequelize)
    ContractABI.register(sequelize)
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
    ContractImpl.register(sequelize );
    // Erc777Transfer.register(sequelize)
    Erc1155Transfer.register(sequelize)
    Erc1155Data.register(sequelize)
    Erc1155Amount.register(sequelize)
    DailyTokenTxn.register(sequelize)
    CfxTransfer.register(sequelize)
    DailyCfxTxn.register(sequelize)
    DailyActiveAddress.register(sequelize)
    DailyToken.register(sequelize)
    FailedTx.register(sequelize)
    AddressStat.register(sequelize)
    Contract.register(sequelize)
    addNameSymbolFailureColumn(sequelize).then()
    Hex40Map.register(sequelize)
    TraceCreateContract.register(sequelize)
    ContractDestroy.register(sequelize)
    Token.register(sequelize);
    NftMint.register(sequelize)
    NftMetaFts.register(sequelize);
    TokenQuoteTrack.register(sequelize);
    KV.register(sequelize);
    Epoch.register(sequelize);
    VerifiedContracts.register(sequelize);
    ProxyVerify.register(sequelize);
    DailyBlockDataStat.register(sequelize);
    DailyGasStat.register(sequelize);
    CfxBalance.register(sequelize);
    TokenSecurityAudit.register(sequelize);
    PruneInfo.register(sequelize);
    Blacklist.register(sequelize);
    RateConfig.register(sequelize);
    HeartBeatBean.register(sequelize);
    GasConsumer.register(sequelize);
    RateKey.register(sequelize);
    RateHit.register(sequelize)
    ESpaceHex40Map.register(sequelize)
    CensorItem.register(sequelize)
    NameTag.register(sequelize)
    VoteParams.register(sequelize)
    DailyBurntFeeStat.register(sequelize)
}
export async function initModel(sequelize: Sequelize) {
    console.log(`init models ...`)
    await initPartialModel(sequelize)
    MinerBlock.register(sequelize);
    NftId.register(sequelize)
    PivotSwitch.register(sequelize)
    CheckBlockInfo.register(sequelize)
    DailyTransaction.register(sequelize);
    DailyCfxHolder.register(sequelize);
    DailyContractCreate.register(sequelize);
    DailyContractStat.register(sequelize);
    DailyContractRegister.register(sequelize);
    DailyNFTStat.register(sequelize);
    DailyNFTHolder.register(sequelize);
    DailyPosRewardStat.register(sequelize);
    DailyPowRewardStat.register(sequelize);
    NFTBalance.register(sequelize);
    EpochTask.register(sequelize);
    EpochHashTokenTransfer.register(sequelize)
    ContractUser.register(sequelize);
    CfxUser.register(sequelize);
    ResultCache.register(sequelize);
    AuthBlockStub.register(sequelize);
    AuthAction.register(sequelize);
    EpochHashCfxTransfer.register(sequelize);
    UniqueAddress.register(sequelize);
    UniqueAddressHourly.register(sequelize);
    UniqueAddressDaily.register(sequelize);
    TxSenderHourly.register(sequelize);
    TxReceiverHourly.register(sequelize);
    TxSenderDaily.register(sequelize);
    TxReceiverDaily.register(sequelize);
    CrossSpaceStat.register(sequelize)
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
    NftTransfer.register(sequelize)
    AddressNfts.register(sequelize)
    EpochAddressIds.register(sequelize)
    if (NoCoreSpace) {
        initBlockWithdrawModel(sequelize);
    }
    /*await checkApiLogIpField()*/
    console.log(`init models ok`);
    await dropEmptyTables();
    await migDB(sequelize);
}

export function createMySql(dbConf) {
    console.log(`create mysql ${dbConf.instanceName}`)
    return new Sequelize(dbConf.instanceName, null, null, dbConf)
}

async function migDB(seq: Sequelize) {
    const qi = seq.getQueryInterface();
    const t = Token.getTableName().toString();
    await addIndexIfNotExistsMySQL(qi, t,'idx_transfer', {fields: ['transfer']});
    await addIndexIfNotExistsMySQL(qi, t,'idx_type', {fields: ['type']});
    await addIndexIfNotExistsMySQL(qi, t,'idx_holder', {fields: ['holder']});

    const tokenSecurityAudit = TokenSecurityAudit.getTableName().toString();
    await addColumnIfNotExistsV2(qi, tokenSecurityAudit, 'officialLabels', {
        type: DataTypes.CHAR(255),
        allowNull: true,
    });

    const verifiedContracts = VerifiedContracts.getTableName().toString();
    await addColumnIfNotExistsV2(qi, verifiedContracts, 'similarMatchChainId', {
        type: DataTypes.INTEGER,
    });
    await addColumnIfNotExistsV2(qi, verifiedContracts, 'similarMatchAddress', {
        type: DataTypes.CHAR(64),
    });
    await changeColumnIfNecessary(qi, verifiedContracts, 'libraries', {
        type: DataTypes.STRING(2048),
    });
    await addColumnIfNotExistsV2(qi, verifiedContracts, 'compiler', {
        type: DataTypes.CHAR(10), allowNull: false, defaultValue: 'solc',
    });
    await addColumnIfNotExistsV2(qi, verifiedContracts, 'codeFormat', {
        type: DataTypes.CHAR(32), allowNull: false, defaultValue: 'Solidity',
    });
    await addColumnIfNotExistsV2(qi, verifiedContracts, 'verifiedAt', {
        type: DataTypes.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00',
    });
    await addColumnIfNotExistsV2(qi, verifiedContracts, 'matchId', {
        type: DataTypes.BIGINT, allowNull: false, defaultValue: '0',
    });
    await addColumnIfNotExistsV2(qi, verifiedContracts, 'addressId', {
        type: DataTypes.BIGINT, allowNull: false, defaultValue: '0',
    });
    await addColumnIfNotExistsV2(qi, verifiedContracts, 'deployer', {
        type: DataTypes.CHAR(64), allowNull: false, defaultValue: '',
    });
    await addColumnIfNotExistsV2(qi, verifiedContracts, 'epochNumber', {
        type: DataTypes.BIGINT, allowNull: false, defaultValue: '0',
    });
    await addColumnIfNotExistsV2(qi, verifiedContracts, 'txns', {
        type: DataTypes.INTEGER, allowNull: false, defaultValue: '0',
    });
    await addColumnIfNotExistsV2(qi, verifiedContracts, 'withNametag', {
        type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false,
    });
    await addIndexIfNotExistsMySQL(qi, verifiedContracts, 'idx_verifiedAt', {fields: ['verifiedAt']});

    const contract = Contract.getTableName().toString();
    await addIndexIfNotExistsMySQL(qi, contract, 'idx_epoch', {fields: ['epoch']});

    const dailyNFTStat = DailyNFTStat.getTableName().toString();
    await changeColumnIfNecessary(qi, dailyNFTStat, 'statType', {
        type: DataTypes.CHAR(3), allowNull: false, defaultValue: '1d',
    });

    const dailyPosRewardStat = DailyPosRewardStat.getTableName().toString();
    await changeColumnIfNecessary(qi, dailyPosRewardStat, 'statType', {
        type: DataTypes.CHAR(3), allowNull: false, defaultValue: '1d',
    });

    const dailyPowRewardStat = DailyPowRewardStat.getTableName().toString();
    await changeColumnIfNecessary(qi, dailyPowRewardStat, 'statType', {
        type: DataTypes.CHAR(3), allowNull: false, defaultValue: '1d',
    });

    const traceCreateContract = TraceCreateContract.getTableName().toString();
    await changeColumnIfNecessary(qi, traceCreateContract, 'codeHash', {
        type: DataTypes.CHAR(66), allowNull: true,
    });

    const kv = KV.getTableName().toString();
    await changeColumnIfNecessary(qi, kv, 'value', {
        type: DataTypes.STRING(8192)
    });

    const contractImpl = ContractImpl.getTableName().toString();
    await changeColumnIfNecessary(qi, contractImpl, 'proxyType', {
        type: DataTypes.STRING(64), allowNull: false, defaultValue: ''
    });
    await addColumnIfNotExistsV2(qi, contractImpl, 'beaconId', {
        type: DataTypes.BIGINT, allowNull: false, defaultValue: 0
    });
}

async function dropEmptyTables() {
    for (let t of []) {
        const sql = `select * from ${t} limit 1`;
        let hasError = false;
        const rows = await KV.sequelize.query(sql, {type: QueryTypes.SELECT}).catch(e=>{
            console.log(`table ${t} error ${e.message}`);
            hasError = true;
            return []; // table may not exist
        });
        if (hasError) {
            continue
        }
        if (rows.length) {
            console.log(`table is not empty`);
            continue;
        }
        await KV.sequelize.query(`drop table if exists ${t}`, {type: QueryTypes.UPDATE});
    }
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

export async function getSlaveStatus(seq:Sequelize) {
    return seq.query('SHOW SLAVE STATUS', {type: QueryTypes.SELECT, raw: true})
        .then(arr => {return arr[0]})
}

interface ColumnAdditionOptions {
    type: DataType;
    allowNull?: boolean;
    defaultValue?: any;
    unique?: boolean;
    primaryKey?: boolean;
    autoIncrement?: boolean;
    comment?: string;
}

async function checkColumnType(table: string, col: string, wantType: string, sql: string) {
    try {
        const tableDescription = await KV.sequelize.getQueryInterface().describeTable(table);
        if (tableDescription[col].type.toUpperCase() !== wantType.toUpperCase()) {
            await KV.sequelize.query(sql, {
                type: QueryTypes.UPDATE,
            })
            console.log(`column modified. ${table}.${col} , old type ${tableDescription[col].type} new type ${wantType}`);
        } else {
            console.log(`column type is the same. ${table}.${col} , old type ${tableDescription[col].type}`);
        }
    } catch (e) {
        console.log(`table ${table} , column ${col}, want type ${wantType} `);
        console.log(`failed to check column type:`, e);
    }
}

export async function addColumnIfNotExistsV2(
    queryInterface: QueryInterface,
    tableName: string,
    columnName: string,
    options: ColumnAdditionOptions
): Promise<void> {
    try {
        const tableDescription = await queryInterface.describeTable(tableName);

        if (!tableDescription[columnName]) {
            console.log(`Adding column "${columnName}" to table "${tableName}"...`);

            await queryInterface.addColumn(tableName, columnName, options);

            console.log(`Column "${columnName}" added successfully`);
        } else {
            console.log(`Column "${columnName}" already exists in table "${tableName}"`);
        }
    } catch (error) {
        if (error.message.startsWith('No description found for')) {
            console.log(` --- table doesn't exist. --- should be created by model. check it.`)
        } else {
            console.error(`Error checking/adding column "${columnName}" to table "${tableName}":`, error);
            throw error;
        }
    }
}

export async function addIndexIfNotExistsMySQL(
    queryInterface: QueryInterface,
    tableName: string,
    indexName: string,
    options: IndexesOptions
): Promise<void> {
    try {
        const [results] = await queryInterface.sequelize.query(
            `SHOW INDEX FROM \`${tableName}\` WHERE Key_name = '${indexName}'`
        );

        const indexExists = Array.isArray(results) && results.length > 0;

        if (!indexExists) {
            console.log(`Index "${indexName}" does not exist on table "${tableName}", creating...`);

            options.name = indexName;
            await queryInterface.addIndex(tableName, options.fields as string[], options);

            console.log(`Index "${indexName}" created successfully`);
        } else {
            console.log(`Index "${indexName}" already exists on table "${tableName}"`);
        }
    } catch (error) {
        if (error.parent?.code === 'ER_NO_SUCH_TABLE') {
            console.log(`mig DB error: ${error.message}`);
        } else {
            console.error(`Error checking/adding index "${indexName}" to table "${tableName}":`, error);
            throw error;
        }
    }
}

export async function changeColumnIfNecessary(
    queryInterface: QueryInterface,
    tableName: string,
    columnName: string,
    options: ColumnAdditionOptions
): Promise<void> {
    try {
        const tableDescription = await queryInterface.describeTable(tableName);
        if (!tableDescription[columnName]) {
            console.log(`Column "${columnName}" not exists in table "${tableName}"`);
        } else {
            console.log(`Changing column "${columnName}" on table "${tableName}"...`);
            await queryInterface.changeColumn(tableName, columnName, options);
            console.log(`Column "${columnName}" changed successfully`);
        }
    } catch (error) {
        if (error.message.startsWith('No description found for')) {
            console.log(` --- table doesn't exist. --- should be created by model. check it.`)
        } else {
            console.error(`Error checking/changing column "${columnName}" to table "${tableName}":`, error);
            throw error;
        }
    }
}
/**
 ALTER TABLE full_block_ext
    REORGANIZE PARTITION p1 INTO (
        PARTITION p01 VALUES LESS THAN (10000000),
        PARTITION p02 VALUES LESS THAN (20000000),
        PARTITION p03 VALUES LESS THAN (30000000)
);
 */
