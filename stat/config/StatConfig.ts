// import {ConfluxOption} from "js-conflux-sdk";
import {ISingleHostConfig} from "influx";

const fs = require('fs')
const templateConf = require('./Template')

export interface ConfluxOption {
    url: string,
    timeout?: number,
    networkId?: number,
    logger?: object,
    defaultGasPrice?: number,
    defaultGasRatio?: number,
    defaultStorageRatio?: number,
    consortiumMode?: boolean, // true: consortium chain; false: public chain
    keepAlive?: boolean,
}
export interface RpcCacheOption {
    // write cache , exclude trace_block ; full block sync sets it.
    writeCache?: boolean
    // only write trace block cache ; cfx transfer sync could set it to true
    writeTraceCache?: boolean
    // read cache , exclude trace_block
    readCache?: boolean
    // read trace_block cache ; epoch sync could set it to true
    readTraceCache?: boolean
    cachePath?: string
}
export interface EtherOption {
    url: string,
}
export interface ConsortiumBridgeOption {
    port: number,
    retry: number,
    rpc: ConfluxOption,
}
export interface Database{
    host: string;
    port: number;
    user: string;
    pwd: string;
    database: string;
    blockTableRowsLimit: number;
    syncSchema: boolean;
    readonly : boolean;
}
export interface DatabaseRW{
    instanceName: string;
    dialect: string;
    port: number;
    replication:Replication;
    logging: boolean;
}
export interface Replication{
    read: MySqlInstance[];
    write: MySqlInstance;
}
export interface MySqlInstance{
    host: string;
    username: string;
    password: string;
}

export interface OssConf {
    accessId: string
    accessKey: string
    bucket: string
    prefix: string // mainnet testnet dev stress pos
}
export interface JSONRpcOption {
    url: string,
    proxy: object,
}
export interface SyncQuoteOption{
    open: boolean;
    interval: {
        bn: number,
        cmc: number,
        moonswap: number,
        swappi: number,
        peer: number,
    },
}
export interface StatConfig{
    influxDB?: ISingleHostConfig & {measurement: string, disable?: boolean}
    oss: OssConf
    firstBlockNo: number
    noCoreSpace: boolean
    pendingTxNotAvailable: boolean
    traceNotAvailable: boolean,
    dingTalkToken: string;
    tgToken?: string; //telegram
    tgChatId?: string //telegram
    syncBlockDelay: number;
    syncTxnDelay: number;
    syncTraceDelay: number;
    syncTraceCreateContractDelay: number;
    port: number;
    apiPort: number;
    v1port: number; // scan-api port, for path /v1
    billingUrl: string;
    billingKey: string;
    billingApp: string;
    conflux: ConfluxOption & RpcCacheOption; // chain rpc node
    blockSyncRpc: ConfluxOption & RpcCacheOption; // chain rpc node
    conflux2?: ConfluxOption; // get cross space info in eSpace, needless in coreSpace
    ether: EtherOption;
    cfxTransferRpc?: ConfluxOption & RpcCacheOption; // for cfx transfer sync
    tokenTransferRpc?: ConfluxOption & RpcCacheOption; // for token transfer sync
    consortiumBridge?: ConsortiumBridgeOption;
    cfxWsUrl: string
    preload: number,
    scanApiUrl: string
    isEvm: boolean,
    scanJsonRpcUrl: string
    database: Database;
    syncBlock: boolean,
    syncTrace: boolean,
    syncTxn: boolean,
    syncTxnCountDaily: boolean,
    syncAnnounce: boolean,
    syncToken: boolean,
    syncAnnounceEpochNumber: number,
    syncTraceCreateContract: boolean,
    syncEpoch: boolean,
    syncEpochNumber: number,
    syncEpochNumberBackward: number,
    serverTag: string,
    watchCfxBalance: boolean,
    cfxWatcherDelay:number,
    recaptchaUrl:string,
    recaptchaToken:string,
    reportUrl: string,

    syncIPFSGateway: boolean,
    syncIPFSGatewayDelay: number,

    syncQuote: SyncQuoteOption,
    quoteConvertSymbolArray: Array<string>,
    marketCapToken: string,
    binanceToken: string,

    syncRecommendGasPrice: boolean,

    syncMinerBlock: boolean,
    syncMinerBlockEpochNumber: number,

    syncContractStatInfoDaily: boolean,
    syncTokenSecurityAudit: boolean,
    syncPrune: boolean,
    syncTransferTps: boolean,

    streamStat: boolean,
    statMinerBlock: boolean,
    statAddrTransaction: boolean,
    statDailyCfxTransfer: boolean,
    statAddrCfxTransfer: boolean,
    statTokenTransfer: boolean,
    statDailyTokenTransfer: boolean,
    statNFTMint: boolean,
    statGasUsedPerSecond: boolean,

    blacklist: boolean,

    databaseRW: DatabaseRW,
    jsonRpc: JSONRpcOption,
    asyncVerifySourcecode: boolean,
    asyncVerifySourcecodeDelay: number,
    metricsEnv: string,

    syncAcrossRegionHost: string,

    ensEnable: boolean,
    ens: string,
    reverseRegistrar: string,
    baseRegistrar: string,
    ensChecker: string,
    reverseRecords: string,

    tldOpenapi: string,

    censorAppId: string,
    censorApiKey: string,
    censorSecretKey: string,

    asyncWrappedToken: boolean,
    wrappedCFX: string,
    wrappedUSDT: string,
}

export var FirstBlockNo = 0
// for chains without core space
export var NoCoreSpace = false

export var CoreDB = 'conflux_scan';
export var EvmDB = "evm";
export var Cfg_is_EVM: boolean = null;
export var ConfigInstance: StatConfig;
/**
 *  Priority from low to high: template.js -> local.js -> specified.js
 */
export function loadConfig(specified:string = undefined): StatConfig {
    let path = `${__dirname}/Local.js`;
    let defaultConf = {default:{firstBlockNo: 0, noCoreSpace: false, coreDB: 'conflux_scan', evmDB: 'evm', isEvm: null}}
    if (fs.existsSync(path)){
        defaultConf = require('./Local')
    }

    let specific = specified === undefined ? {default:{}} : require(`./${specified}`)
    // console.log(`template is 0 `, templateConf.default)
    // console.log(`specific is `, specific)
    const conf = {...templateConf.default, ...defaultConf.default, ...specific.default}
    FirstBlockNo = conf.firstBlockNo
    NoCoreSpace = conf.noCoreSpace
    CoreDB = conf.coreDB;
    EvmDB = conf.evmDB;
    Cfg_is_EVM = conf.isEvm;
    if(conf?.consortiumBridge) {
        console.log(`web port [${conf.consortiumBridge.port}] rpc [`, conf.consortiumBridge.rpc, `]`)
        return conf;
    }

    const {databaseRW:{replication:{write:{host: writeHost, username}, read:[{host:readHost}]}}} = conf
    console.log(`database conf, host: write ${writeHost
    } read ${readHost}, user ${username} DB ${conf.databaseRW.instanceName
    }. web port [${conf.port}].`)
    ConfigInstance = conf;
    return conf;
}
