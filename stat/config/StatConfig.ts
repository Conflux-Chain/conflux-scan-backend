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
}
export interface StatConfig{
    dingTalkToken: string;
    syncBlockDelay: number;
    syncTxnDelay: number;
    syncTraceDelay: number;
    syncTraceCreateContractDelay: number;
    port: number;
    conflux: ConfluxOption; // chain rpc node
    cfxWsUrl: string
    scanApiUrl: string
    scanJsonRpcUrl: string
    database: Database;
    syncBlock: boolean,
    syncTrace: boolean,
    syncTxn: boolean,
    syncTxnCountDaily: boolean,
    syncTxnCountHistory: boolean,
    syncCfxHolderCountDaily: boolean,
    syncToken: boolean,
    syncTraceCreateContract: boolean,
    serverTag: string,
    erc20watchList:Erc20WatchList[],
    watchCfxBalance: boolean,
    cfxWatcherDelay:number,
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
    }, blockTableRowsLimit [${conf.blockTableRowsLimit}]. web port [${conf.port}].`)
    return conf;
}