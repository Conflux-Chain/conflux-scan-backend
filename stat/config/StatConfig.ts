import * as os from "os";
import {ISingleHostConfig} from "influx";
import {Options} from "sequelize";

const fs = require('fs')
const template = require(('./Template'))

export interface StatConfig {
    /** api configurations */
    serverTag: string;
    port: number;
    apiPort: number;
    v1port: number; // scan-api port, for path /v1
    diffMonitorPort?: number; // -9000 to disable

    /** blockchain rpc configurations */
    conflux: ConfluxOption; // chain rpc node
    conflux2?: ConfluxOption; // get cross space info in eSpace, needless in coreSpace
    ether?: EtherOption;
    blockSyncRpc?: ConfluxOption; // chain rpc node
    cfxTransferRpc?: ConfluxOption; // for cfx transfer sync
    tokenTransferRpc?: ConfluxOption; // for token transfer sync
    consortiumBridge?: ConsortiumBridgeOption;
    cfxWsUrl?: string;

    /** persistence configurations */
    database: Database;
    influxDB: ISingleHostConfig & { measurement: string, disable?: boolean };
    oss: OssConf;

    /** sync configurations */
    firstBlockNo: number;
    watchCfxBalance: boolean,
    useGetLogs: boolean;
    getLogsRange?: number;
    getLogsJobCount?: number;
    getLogsDbBatchSize?: number;

    /** 0g configurations */
    noCoreSpace: boolean;
    noTopToken: boolean;
    traceNotAvailable: boolean;
    pendingTxNotAvailable: boolean;
    onlyStatActiveContract: boolean;
    validatorRpc?: string, // evm pos validator information api

    /** log configurations */
    requestLogger?: RequestLoggerOptions;

    /** billing configurations */
    billingApp?: string;

    /** alert configurations */
    dingTalkToken: string;
    dingDevToken: string;
    tgToken?: string;
    tgChatId?: string;

    /** address configurations */
    // censor
    censor: CensorOptions;

    /** token configurations */
    // price
    quote: QuoteOptions;

    /** contract configurations */
    // verify
    verification: VerificationOptions;
}

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

export interface Database extends Options {
    useMysql: boolean;
    readonly: boolean;
    syncSchema: boolean;
    instanceName: string;
}

export interface OssConf {
    region?: string;
    accessId: string
    accessKey: string
    bucket: string
    prefix: string // mainnet testnet dev stress pos
}

export interface RequestLoggerOptions {
    enable: boolean;
    level?: 'trace' | 'info' | 'warn' | 'error' | 'fatal';
    format?: 'json'| "readable" | "object";
    request?: {
        timestamp: boolean,
        http: boolean,
        method: boolean,
        url: boolean,
        params: boolean,
        query: boolean,
        header: boolean,
        body: boolean,
    };
    response?: {
        duration: boolean,
        length: boolean,
        status: boolean,
        message: boolean,
        header: boolean,
        body: boolean,
    };
}

export interface CensorOptions {
    enable: boolean;
    appId?: string;
    apiKey?: string;
    secretKey?: string;
    interval?: number;
}

export interface QuoteOptions {
    enable: true;
    binanceAccessToken: string;
    coinMarketCapAccessToken: string;
    binanceFetchIntervalSec?: number;
    coinMarketCapFetchIntervalSec?: number;
    disableAlertPullPeer?: boolean,
}

export interface VerificationOptions{
    enable: boolean;
    url: string;
}

export var FirstBlockNo = 0;
export var NoCoreSpace = false; // for chains without core space
export var CoreDB = 'conflux_scan';
export var EvmDB = "evm";
export var Cfg_is_EVM: boolean = null;
export var ConfigInstance: StatConfig;

/**
 *  Priority from low to high: Template.js -> Local.js -> Specified.js
 */
export function loadConfig(specified: string = undefined): StatConfig {
    const local = fs.existsSync(`${__dirname}/Local.js`) ? require('./Local') : {
        default: {
            coreDB: 'conflux_scan',
            evmDB: 'evm'
        }
    };

    const specific = specified ? require(`./${specified}`) : {};

    const config = {...template.default, ...local.default, ...specific.default};
    config.serverTag = `${config.serverTag}@${os.hostname()}`;

    FirstBlockNo = config.firstBlockNo
    NoCoreSpace = config.noCoreSpace
    CoreDB = config.coreDB;
    EvmDB = config.evmDB;
    ConfigInstance = config;
    Cfg_is_EVM = config.isEvm;

    return config;
}
