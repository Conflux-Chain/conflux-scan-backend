import * as fs from "fs";
import {readFileSync} from "fs";
import {URL} from "url";
import {post} from "./http";
import {ConfluxOption, } from "../../config/StatConfig";

const HttpProvider = require("js-conflux-sdk/src/provider/HttpProvider")
const superagent = require('superagent');
const Agent = require('agentkeepalive');
const pLimit = require('p-limit');

const limit = pLimit(100); // could increase it when connection issues are fixed completely.

export class ScanHttpProvider extends HttpProvider {
    tag: string
    times = 0
    agent = new Agent({maxSockets: 100, timeout:73000, keepAlive: true, })
    conf: ConfluxOption
    methodTimes = {}
    constructor(conf: ConfluxOption, tag: string) {
        super(conf);
        // this.headers = {Connection: "keep-alive"}
        this.tag = tag
        this.url = new URL(conf.url)
        this.url.headers = {
            'Connection': 'keep-alive',
            'Content-type': 'application/json'
        }
        this.conf = conf;
    }

    async _doRequest(data) {
        return limit(()=>this.request0(data))
    }
    async request0(data) {
        // await new Promise(r=>setTimeout(r, 2000))
        // this.methodTimes[data.method] = (this.methodTimes[data.method] || 0) + 1
        // console.log(` ----- ${this.tag}, total times ${this.times}: request rpc ${data.method
        // } x ${this.methodTimes[data.method]}, header `, this.headers)
        const { body, error } = await superagent
            .post(this.url)
            .agent(this.agent)
            .retry(this.retry)
            .set(this.headers)
            .send(data)
            .timeout(this.timeout);
        if (!body) {
            console.log(`request fail, payload `, data, 'result', error )
        }
        return body || {};
    }
}

export const CacheConfig = {
    cfx_getBlocksByEpoch: ([no])=>{
        return BigInt(no); // NO is a hex str
    },
    cfx_getBlockByHash: ([hash, detail])=>{
        return `${hash}_${detail}`
    },
    cfx_getEpochReceipts: ([noOrPivotHashOrObj])=>{
        // noOrPivotHashOrObj could be {
        //   blockHash: '0x335b37e235c9d4d3163fe2549469e9847a1aac77e0d5efcfe6668bdfa7c6bbb2',
        //   requirePivot: true
        // }
        return noOrPivotHashOrObj.blockHash ?? (typeof noOrPivotHashOrObj === 'string' ? noOrPivotHashOrObj : BigInt(noOrPivotHashOrObj));
    },
    cfx_getBlockByHashWithPivotAssumption: ([bHash, pHash, epHex])=>{
        return `${bHash}_${pHash}_${BigInt(epHex)}`
    },
    trace_block:([hash])=>{
        return hash;
    }
}

