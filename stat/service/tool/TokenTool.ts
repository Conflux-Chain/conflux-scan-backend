import {Conflux} from "js-conflux-sdk";
import {Token} from "../../model/Token";
import {init} from "./FixDailyTokenStat";
import {patchHttpProvider} from "../common/utils";
import {HASH_CUSTODIAN_TOKEN, RedisWrap} from "../RedisWrap";
import {decodeUtf8} from "./StringTool";
const abi = require('./abi');
const fs = require('fs');
const path = require('path');
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
export async function isCustodianToken(base32:string) {
    return RedisWrap.hGet(HASH_CUSTODIAN_TOKEN, base32, '').then(Boolean)
}
// 0x890e3feac4a2c33d7594bc5be62e7970ef5481e0
export const CUSTODIAN_PROXY_CONTRACT = 'cfx:aceu6t9m2wvpgtnzww8f13vstf2s8zeb6a4eja1756'
async function updateCustodianTokenFlag() {
    const tool = await initTool()
    async function repeat() {
        const list = await Token.findAll({where: {auditResult: true,}});
        let trueCount = 0
        let testOne = ''
        for (const token of list) {
            const is = await tool.contract.isToken(token.base32)
                .call({to: CUSTODIAN_PROXY_CONTRACT}).catch(err => {
                    console.log(`call proxy contract fail, token ${token.base32}`, err)
                    return false
                })
            trueCount += is ? 1 : 0
            if (is) {
                testOne = token.base32
            }
            await RedisWrap.hSet(HASH_CUSTODIAN_TOKEN, token.base32, is ? '1' : '');
        }
        setTimeout(repeat, 10_000)
        console.log(`set to true count ${trueCount}, test get ${testOne}, ${await isCustodianToken(testOne)}`)
        console.log(`get all `,await RedisWrap.hGetAll(HASH_CUSTODIAN_TOKEN))
    }
    repeat().then()
}


async function base64ToPNG(token:Token, dir: string) {
    if (!token.icon) {
        console.log(`icon is not present. ${token.symbol} ${token.name} ${token.base32}`)
        return
    }
    let raw_data = decodeUtf8(token.icon);
    // console.log(`data [${raw_data.substr(0,64)}]`)
    const data = raw_data.replace(/^data:image.*base64,/, '');
    let imageType = '.png'
    if (raw_data.includes('image/svg')) {
        imageType = '.svg'
    } else if (raw_data.includes('image/vnd.microsoft.icon')) {
        imageType = '.icon'
    } else if (raw_data.includes('image/png')) {
    } else if (raw_data.includes('image/jpg')) {
        imageType = '.jpg'
    } else if (raw_data.includes('image/jpeg')) {
        imageType = '.jpeg'
    } else {
        console.log(`unknown type ${raw_data.substr(0, 64)}`)
        return
    }
    const filename = `${token.base32}${imageType}`;
    fs.writeFileSync(path.resolve(dir, filename), data, 'base64');
    await Token.update({iconUrl: `${filename}`}, {
        where: {id: token.id}
    })
}

async function buildImages() {
    await init()
    const public_dir = __dirname + '/../../../../public/stat/';
    const dir = path.resolve(public_dir);
    console.log(`will save at ${public_dir}\n${dir}`)
    const list = await Token.findAll({where: {auditResult: true,}})
    for (let i = 0; i < list.length; i++){
        let token = list[i];
        await base64ToPNG(token, dir)
    }
    console.log(`done.`)
}
async function initTool() {
    const cfg = await init()
    const cfx = new Conflux(cfg.conflux)
    console.log(`conflux: `, cfg.conflux)
    patchHttpProvider(cfx, cfg.conflux)
    await RedisWrap.connect(cfg.redis)
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
            if (sup === undefined || sup === null) {
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
    } else if (args[0] === 'build_images') {
        buildImages().then(()=>{
            Token.sequelize.close().then()
        })
    } else {
        updateTotalSupply().then()
    }
}