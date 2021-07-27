import {Conflux} from "js-conflux-sdk";
const abi = require('./abi');
const lodash = require('lodash');

const NodeCache = require( "node-cache" );
const dbCache = new NodeCache()
const cacheTtl = 60 * 50 // 50 minutes
export function addTokenCache(obj:{name?, symbol, decimals?, granularity?, base32:string}) {
    dbCache.set(obj.base32 || '', obj, cacheTtl)
}
export class TokenTool {
    protected cfx;
    protected contract;
    constructor(cfx:Conflux) {
        this.cfx = cfx;
        this.contract = cfx.Contract({abi});
    }

    async getToken(address, epochNumber = undefined): Promise<any> {
        const cache = dbCache.get(address)
        if (cache) {
            dbCache.set(address, cache, cacheTtl)
            return cache
        }
        return this.awaitObject({
            address,
            name: this.contract.name()
                .call({to: address}, epochNumber)
                .catch(() => undefined),
            symbol: this.contract.symbol()
                .call({to: address}, epochNumber)
                .catch(() => undefined),
            decimals: this.contract.decimals()
                .call({to: address}, epochNumber)
                .then(Number)
                .catch(() => undefined),
            granularity: this.contract.granularity()
                .call({to: address}, epochNumber)
                .then(Number)
                .catch(() => undefined),
        }).then(obj=>{
            dbCache.set(address, obj, cacheTtl)
            return obj;
        });
    }

    async getTokenTotalSupply(address, epochNumber = undefined) {
        return this.contract.totalSupply()
            .call({to: address}, epochNumber)
            .then(BigInt)
            .catch(() => undefined);
    }

    async awaitObject(object): Promise<any> {
        const result = {};
        await Promise.all(lodash.map(object, async (promise, key) => {
            result[key] = await promise;
        }));
        return result;
    }

    decodeAnnounce(eventLog) {
        try {
            const tuple = this.contract.Announce.decodeLog(eventLog);
            return { ...eventLog, ...tuple.toObject() };
        } catch (e) {
            // pass
        }
        return undefined;
    }
}
