import {ConfluxOption} from "js-conflux-sdk";
const fs = require('fs')
const templateConf = require('./Template')

export interface Database{
    host: string;
    user: string;
    pwd: string;
    database: string;
    blockTableRowsLimit: number;
}
export interface StatConfig{
    port: number;
    conflux: ConfluxOption; // chain rpc node
    database: Database
}

/**
 *  Priority from low to high: template.js -> local.js -> specified.js
 */
export function loadConfig(specified:string = undefined): StatConfig {
    let path = `${__dirname}/local.js`;
    let defaultConf = {default:{}}
    if (fs.existsSync(path)){
        defaultConf = require('./local')
    }
    let specific = specified === undefined ? {default:{}} : require(`./${specified}`)
    // console.log(`template is 0 `, templateConf.default)
    // console.log(`specific is `, specific)
    const conf = {...templateConf.default, ...defaultConf.default, ...specific.default}
    console.log(`conf is `, conf)
    return conf;
}