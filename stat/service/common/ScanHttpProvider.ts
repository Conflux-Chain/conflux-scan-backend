import * as fs from "fs";
import {readFileSync} from "fs";
import {URL} from "url";
import {post} from "./http";
import {ConfluxOption, RpcCacheOption} from "../../config/StatConfig";

const HttpProvider = require("js-conflux-sdk/src/provider/HttpProvider")
const superagent = require('superagent');
const Agent = require('agentkeepalive');
const pLimit = require('p-limit');
const limit = pLimit(1000); // could increase it when connection issues are fixed completely.
export class ScanHttpProvider extends HttpProvider {
    tag: string
    times = 0
    agent = new Agent({maxSockets: 100, timeout:73000})
    conf: ConfluxOption & RpcCacheOption
    methodTimes = {}
    constructor(conf: ConfluxOption & RpcCacheOption, tag: string) {
        super(conf);
        // this.headers = {Connection: "keep-alive"}
        this.tag = tag
        this.url = new URL(conf.url)
        this.url.headers = {
            'Connection': 'keep-alive',
            'Content-type': 'application/json'
        }
        this.conf = conf;
        if ((conf.writeCache || conf.readCache || conf.writeTraceCache) ) {
            if (!conf.cachePath) {
                console.log(`${__filename} must set cache path`)
                process.exit(9)
            }
            if (__filename.startsWith("/scan") && conf.cachePath.startsWith("/stat-root")) {
                conf.cachePath = conf.cachePath.replace("/stat-root", "/scan")
            }
            // test write
            try {
                fs.writeFileSync(`${conf.cachePath}/testWrite.txt`, "a test file")
            } catch (e) {
                console.log(`failed to write in cache path`, e)
                process.exit(9)
            }
        }
    }

    async _doRequest(data) {
        const shouldWriteCache = this.conf.writeCache || (this.conf.writeTraceCache && data.method == 'trace_block');
        return limit(()=>shouldWriteCache ? this.requestAndCache(data) : this.request0(data))
    }
    async requestAndCache(data) {
        const text = await post(this.url, data)
        return cacheRes(text, data, this.conf.cachePath);
    }
    async request0(data) {
        const shouldReadCache = data.method === 'trace_block' ? this.conf.readTraceCache : this.conf.readCache;
        if (shouldReadCache) {
            const cache = readCache(data.method, data.params, this.conf.cachePath)
            if (cache) {
                return cache;
            }
        }
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

async function cacheRes(text : string, data: any, cacheDir: string) {
    let body: any;
    try {
        body = JSON.parse(text);
    } catch (e) {
        console.log(`bad json text`, text)
        throw e;
    }
    // console.log(`${__filename} method is `, data.method)
    const parseParamFn = CacheConfig[data.method];
    if (parseParamFn && body.result) {
        const path = `${cacheDir}/${data.method}_${parseParamFn(data.params)}.json.tmp`;
        await fs.promises.writeFile(path, text).then(()=>{
            return onlineCache(body.result, path);
        }).catch(e=>{
            console.log(`failed to write/online cache file ${path}`, e)
        })
    }
    return body
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
    trace_block:([hash])=>{
        return hash;
    }
}

export async function onlineCache(obj: any, path: string ) {
    if (!path) {
        // console.log(`${__filename} path is empty`, path)
        return
    }
    fs.renameSync(path, path.slice(0, path.length - 4)); // 4 is ".tmp".length
    // console.log(`online cache ${path}`)
}
let hitCaches = 0
function readCache(method, params, cacheDir: string) : any {
    const parseParamFn = CacheConfig[method];
    if (parseParamFn) {
        const path = `${cacheDir}/${method}_${parseParamFn(params)}.json`;
        let text: string;
        try {
            text = readFileSync(path, "utf-8").toString();
        } catch (e) {
            console.log(`failed to load cache file`, e.message)
            return undefined
        }
        try {
            const parsed = JSON.parse(text);
            hitCaches += 1;
            if (hitCaches % 1000 == 1) {
                console.log(`hit caches ${hitCaches} . current path ${path}`)
            }
            return parsed;
        } catch (e) {
            console.log(`failed to parse cache at ${path} \n content [ ${text} ]\n`, e)
        }
    }
    return undefined
}
