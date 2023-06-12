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
export interface RedisConf {
    host:string
    port:number,
    db:number,
    pwd:string
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
export interface StatConfig{
    redis: RedisConf
    influxDB?: ISingleHostConfig
    oss: OssConf
    dingTalkToken: string;
    syncBlockDelay: number;
    syncTxnDelay: number;
    syncTraceDelay: number;
    syncTraceCreateContractDelay: number;
    port: number;
    apiPort: number;
    billingUrl: string;
    billingKey: string;
    billingApp: string;
    conflux: ConfluxOption; // chain rpc node
    ether: EtherOption;
    cfxTransferRpc?: ConfluxOption; // for cfx transfer sync
    tokenTransferRpc?: ConfluxOption; // for token transfer sync
    consortiumBridge?: ConsortiumBridgeOption;
    cfxWsUrl: string
    preload: number,
    scanApiUrl: string
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
    erc20watchList:Erc20WatchList[],
    watchCfxBalance: boolean,
    cfxWatcherDelay:number,
    recaptchaUrl:string,
    recaptchaToken:string,
    reportUrl: string,

    syncQuote: boolean,
    syncQuoteDelay: number,
    syncIPFSGateway: boolean,
    syncIPFSGatewayDelay: number,
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

    pullPrice: boolean,
    tldOpenapi: string,

    censorAppId: string,
    censorApiKey: string,
    censorSecretKey: string,
}

export interface Erc20WatchList{
    // hex address
    address:string
    // it's the symbol of the token. why not use real name : real name contains space.
    name:string
    watchDelay:number
    tokenType:string // erc1155 needs a token type
}

/**
 *  Priority from low to high: template.js -> local.js -> specified.js
 */
export function loadConfig(specified:string = undefined): StatConfig {
    let path = `${__dirname}/Local.js`;
    let defaultConf = {default:{}}
    if (fs.existsSync(path)){
        defaultConf = require('./Local')
    }

    let specific = specified === undefined ? {default:{}} : require(`./${specified}`)
    // console.log(`template is 0 `, templateConf.default)
    // console.log(`specific is `, specific)
    const conf = {...templateConf.default, ...defaultConf.default, ...specific.default}
    if(conf?.consortiumBridge) {
        console.log(`web port [${conf.consortiumBridge.port}] rpc [`, conf.consortiumBridge.rpc, `]`)
        return conf;
    }

    const {databaseRW:{replication:{write:{host: writeHost, username}, read:[{host:readHost}]}}} = conf
    console.log(`database conf, host: write ${writeHost
    } read ${readHost}, user ${username} DB ${conf.databaseRW.instanceName
    }. web port [${conf.port}].`)
    return conf;
}
