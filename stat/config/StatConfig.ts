import {ConfluxOption} from "js-conflux-sdk";
const fs = require('fs')
const templateConf = require('./Template')

export interface Database{
    host: string;
    user: string;
    pwd: string;
    database: string;
    blockTableRowsLimit: number;
    syncSchema: boolean;
}
export interface StatConfig{
    syncBlockDelay: number;
    syncTxnDelay: number;
    port: number;
    conflux: ConfluxOption; // chain rpc node
    database: Database;
    syncBlock: boolean,
    syncTxn: boolean,
    serverTag: string,
    erc20watchList:Erc20WatchList[],
    cfxWatcherDelay:number,
}

export interface Erc20WatchList{
    address:string
    name:string
    watchDelay:number
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