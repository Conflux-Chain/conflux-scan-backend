// import {ConfluxOption} from "js-conflux-sdk";
import {ISingleHostConfig} from "influx";
import * as os from "os";
import {Options} from "sequelize";

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
export interface DatabaseRW extends Options {
    instanceName: string;
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
    useGetLogs: boolean;
    getLogsRange?: number;
    getLogsJobCount?: number;
    getLogsDbBatchSize?: number;
    influxDB?: ISingleHostConfig & {measurement: string, disable?: boolean}
    oss: OssConf
    firstBlockNo: number
    noCoreSpace: boolean
    pendingTxNotAvailable: boolean
    traceNotAvailable: boolean,
    dingTalkToken: string;
    dingDevToken: string;
    tgToken?: string; //telegram
    tgChatId?: string //telegram
    port: number;
    apiPort: number;
    v1port: number; // scan-api port, for path /v1
    billingApp: string;
    conflux: ConfluxOption; // chain rpc node
    blockSyncRpc: ConfluxOption; // chain rpc node
    conflux2?: ConfluxOption; // get cross space info in eSpace, needless in coreSpace
    ether: EtherOption;
    cfxTransferRpc?: ConfluxOption; // for cfx transfer sync
    tokenTransferRpc?: ConfluxOption; // for token transfer sync
    consortiumBridge?: ConsortiumBridgeOption;
    cfxWsUrl: string
    preload: number,
    scanApiUrl: string
    isEvm: boolean,
    scanJsonRpcUrl: string
    database: Database;
    serverTag: string,
    watchCfxBalance: boolean,
    recaptchaUrl:string,
    recaptchaToken:string,
    reportUrl: string,

    syncIPFSGateway: boolean,
    syncIPFSGatewayDelay: number,

    syncQuote: SyncQuoteOption,
    quoteConvertSymbolArray: Array<string>,
    marketCapToken: string,
    binanceToken: string,

    syncTokenSecurityAudit: boolean,
    noTopToken: boolean,
    onlyStatActiveContract: boolean,
    blacklist: boolean,

    databaseRW: DatabaseRW,
    jsonRpc: JSONRpcOption,
    metricsEnv: string,

    ensEnable: boolean,
    ens: string,
    reverseRegistrar: string,
    baseRegistrar: string,
    ensChecker: string,
    reverseRecords: string,

    tldOpenapi: string, // top level domain of open api

    censorAppId: string,
    censorApiKey: string,
    censorSecretKey: string,

    asyncWrappedToken: boolean,
    wrappedCFX: string,
    wrappedUSDT: string,

    enableProfile: boolean,

    contractVerificationUrl: string,
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
    conf.serverTag = `${conf.serverTag}@${os.hostname()}`
    const {databaseRW:{replication:{write:{host: writeHost, username}, read:[{host:readHost}]}}} = conf
    console.log(`database conf, host: write ${writeHost
    } read ${readHost}, user ${username} DB ${conf.databaseRW.instanceName
    }. web port [${conf.port}].`)
    ConfigInstance = conf;
    return conf;
}
