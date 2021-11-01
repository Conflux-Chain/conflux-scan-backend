import {ConfluxOption} from "js-conflux-sdk";
const fs = require('fs')
const templateConf = require('./Template')

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
export interface StatConfig{
    redis: RedisConf
    oss: OssConf
    dingTalkToken: string;
    syncBlockDelay: number;
    syncTxnDelay: number;
    syncTraceDelay: number;
    syncTraceCreateContractDelay: number;
    port: number;
    conflux: ConfluxOption; // chain rpc node
    cfxWsUrl: string
    preload: number,
    scanApiUrl: string
    scanJsonRpcUrl: string
    database: Database;
    syncBlock: boolean,
    syncTrace: boolean,
    syncTxn: boolean,
    syncTxnCountDaily: boolean,
    syncCfxHolderCountDaily: boolean,
    syncAnnounce: boolean,
    syncToken: boolean,
    syncAnnounceEpochNumber: number,
    syncTraceCreateContract: boolean,
    syncEpoch: boolean,
    syncEpochNumber: number,
    syncContractCreateCountDaily: boolean,
    serverTag: string,
    checkRankDelay: boolean,
    erc20watchList:Erc20WatchList[],
    watchCfxBalance: boolean,
    cfxWatcherDelay:number,
    recaptchaUrl:string,
    recaptchaToken:string,
    reportUrl: string,

    syncQuote: boolean,
    syncQuoteDelay: number,
    quoteConvertSymbolArray: Array<string>,
    marketCapToken: string,
    binanceToken: string,

    syncHomeDashboardData: boolean,
    syncHomeDashboardDataDelay: number,

    syncMinerBlock: boolean,
    syncMinerBlockEpochNumber: number,

    syncContractStatInfoDaily: boolean,
    syncContractRegisterCountDaily: boolean,
    syncBlockDataStatDaily: boolean,
    syncTokenSecurityAudit: boolean,
    syncPrune: boolean,
    databaseRW: DatabaseRW,
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
    console.log(`conf is host ${conf.database.host}, user ${conf.database.user} DB ${conf.database.database
    }. web port [${conf.port}].`)
    return conf;
}
