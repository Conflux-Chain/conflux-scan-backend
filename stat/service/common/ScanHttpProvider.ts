import * as fs from "fs";
import {URL} from "url";
import {post} from "./http";
import {readFileSync} from "fs";

const HttpProvider = require("js-conflux-sdk/src/provider/HttpProvider")
const superagent = require('superagent');
const Agent = require('agentkeepalive');
const pLimit = require('p-limit');
const limit = pLimit(1000); // could increase it when connection issues are fixed completely.
export class ScanHttpProvider extends HttpProvider {
    tag: string
    times = 0
    agent = new Agent({maxSockets: 100, timeout:73000})
    conf: {readCache: boolean, writeCache: boolean, cachePath: string}
    methodTimes = {}
    constructor(conf, tag) {
        super(conf);
        // this.headers = {Connection: "keep-alive"}
        this.tag = tag
        this.url = new URL(conf.url)
        this.url.headers = {
            'Connection': 'keep-alive',
            'Content-type': 'application/json'
        }
        this.conf = conf;
        if ((conf.writeCache || conf.readCache) ) {
            if (!conf.cachePath) {
                console.log(`${__filename} must set cache path`)
                process.exit(9)
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
        return limit(()=>this.conf.writeCache ? this.requestAndCache(data) : this.request0(data))
    }
    async requestAndCache(data) {
        const text = await post(this.url, data)
        return cacheRes(text, data, this.conf.cachePath);
    }
    async request0(data) {
        if (this.conf.readCache) {
            const cache = readCache(data.method, data.params, this.conf.cachePath)
            if (cache) {
                // console.log(`hit cache`)
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
    cfx_getEpochReceipts: ([no])=>{
        return BigInt(no);
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
            if (hitCaches % 100 == 1) {
                console.log(`hit caches ${hitCaches} . current path ${path}`)
            }
            return parsed;
        } catch (e) {
            console.log(`failed to parse cache at ${path} \n content [ ${text} ]\n`, e)
        }
    }
    return undefined
}
