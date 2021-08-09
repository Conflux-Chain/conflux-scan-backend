import {Conflux} from "js-conflux-sdk";
import {Token} from "../../model/Token";
import {init} from "./FixDailyTokenStat";
import {patchHttpProvider} from "../common/utils";
import {HASH_CUSTODIAN_TOKEN, RedisWrap} from "../RedisWrap";
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
    contract;
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

async function updateCustodianTokenFlag() {
    const tool = await initTool()
    async function repeat() {
        const list = await Token.findAll({where: {auditResult: true,}});
        let trueCount = 0
        for (const token of list) {
            const is = await tool.contract.totalSupply()
                .call({to: token.base32}).catch(err => {
                    console.log(`call proxy contract fail, token ${token.base32}`, err)
                    return false
                })
            trueCount += is ? 1 : 0
            await RedisWrap.hSet(HASH_CUSTODIAN_TOKEN, token.base32, is ? '1' : '')
        }
        setTimeout(repeat, 10_000)
        console.log(`set to true count ${trueCount}`)
    }
    repeat().then()
}

async function initTool() {
    const cfg = await init()
    const cfx = new Conflux(cfg.conflux)
    console.log(`conflux: `, cfg.conflux)
    patchHttpProvider(cfx, cfg.conflux)
    const tool = new TokenTool(cfx)
    return tool;
}

async function updateTotalSupply() {
    const tool = await initTool();

    async function repeat() {
        const list = await Token.findAll({where: {auditResult: true,
                // symbol:'PHM-NFT'
        }})
        for (const token of list) {
            const sup = await tool.contract.totalSupply()
                .call({to: token.base32}, undefined)
                .then(BigInt)
                .catch((err) => {
                    if (!err.message.includes('Transaction')) {
                        console.log(`totalSupply error:`, err)
                    }
                    return undefined
                })
            if (sup === undefined) {
                continue
            }
            if (sup === BigInt(token.totalSupply)) {
                continue
            }
            const [cnt] = await Token.update({totalSupply: sup},
                {where: {id: token.id}});
            console.log(`update from ${token.totalSupply} to ${sup}, affect ${cnt} ${token.base32}`)
        }
        setTimeout(repeat, 10_000)
        console.log(`${new Date().toISOString()} updated ${list.length}`)
    }
    repeat().then()
}

if (module === require.main) {
    const args = process.argv.slice(2)
    if (args[0] === 'custodian_token') {
        updateCustodianTokenFlag().then()
    } else {
        updateTotalSupply().then()
    }
}