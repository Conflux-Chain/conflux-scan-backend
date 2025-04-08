import {Sequelize, Model, DataTypes} from 'sequelize'
import {RateLimiterMemory, BurstyRateLimiter} from 'rate-limiter-flexible'
import {Errors} from "../service/common/LogicError";
import {decodeApiKey} from "web3pay-sdk-js"
import {getVipInfo, getWeb3pay} from "web3pay-sdk-js/lib/rpc";

const lodash = require('lodash');

export interface IRateConfig {
    id?: number;
    name: string;
    weight: number;
}

export class RateConfig extends Model<IRateConfig> implements IRateConfig {
    static defaultWeightName = 'defaultWeight'
    static addressWeightName = 'address'
    id?: number;
    name: string;
    weight: number;

    static register(seq: Sequelize) {
        RateConfig.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
            name: {type: DataTypes.STRING(256), allowNull: false, unique: true},
            weight: {type: DataTypes.FLOAT, allowNull: false},
        }, {
            sequelize: seq, tableName: 'rate_config',
        })
    }
}

export interface IRateHit {
    id?: number;
    ip: string;
    path: string
}

export class RateHit extends Model<IRateHit> implements IRateHit {
    id?: number;
    ip: string;
    path: string

    static register(seq: Sequelize) {
        RateHit.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
            ip: {type: DataTypes.STRING(64), allowNull: false},
            path: {type: DataTypes.STRING(256), allowNull: false},
        }, {
            sequelize: seq, tableName: 'rate_hit',
        })
    }
}

const configMap = new Map<string, IRateConfig>();
const frequentPaths = ['/open/nft/preview', '/stat/nft/checker/preview'];
frequentPaths.forEach(name => {
    configMap.set(name, {name, weight: 0.01})
})
let timer;
export async function loadRateConfig() {
    const list = await RateConfig.findAll()
    list.forEach(c => {
        configMap.set(c.name, c)
    })
    if (!list.length) {
        RateConfig.bulkCreate([
            {name: RateConfig.defaultWeightName, weight: 1},
            {name: RateConfig.addressWeightName, weight: 0.1},
            ...frequentPaths.map(path => {
                return {name: path, weight: 0.01}
            }),
        ]).then()
    }
    if (!timer) {
        timer = setInterval(loadRateConfig, 10_000)
    }
}

// https://github.com/animir/node-rate-limiter-flexible/wiki/BurstyRateLimiter
const burstyLimiter = new BurstyRateLimiter(
    new RateLimiterMemory({
        keyPrefix: '',
        points: 10, // change weight , do not change this.
        duration: 1, //second
    }),
    new RateLimiterMemory({
        keyPrefix: 'burst',
        points: 50,
        duration: 10,
    })
);

export function getClientIP(ctx) {
    if (!ctx) {
        return '-';
    }
    if (ctx.headers) {
        return ctx.headers['ali-cdn-real-ip'] || ctx.headers['cf-connecting-ip'] || ctx.request?.ip;
    }
    return ctx.request?.ip || '~';
}

export async function checkRate(ctx, next) {
    const {path} = ctx.request;
    const ip = getClientIP(ctx);
    ctx.set("ip", ip);
    const key = ip
    let nonVarPath = path;
    if (path?.startsWith("/v1/transferTree/0x")) {
        nonVarPath = "/v1/transferTree/"
    }
    // resources like nftPreview should have a small weight like 0.01.
    let pointsToConsume = configMap.get(nonVarPath)?.weight || configMap.get(RateConfig.defaultWeightName)?.weight || 1;
    const {ok: paid} = await checkApiKey(nonVarPath, ctx?.request?.query?.apiKey || ctx?.headers['apiKey'])
    if (paid) {
        pointsToConsume /= 10;
    }
    try {
        await burstyLimiter.consume(key, pointsToConsume)
        ctx?.set(`pointsIP`, pointsToConsume)
        ctx?.set(`IP`, ip)
        ctx?.set('paid', paid)
    } catch (e) {
        RateHit.sequelize && RateHit.create({ip, path}).catch()
        ctx.body = {
            code: 429,
            message: `Too many requests, path ${path}. Allow ${burstyLimiter["points"] / pointsToConsume}/s`
        }
        return
    }
    await next()
}

export async function checkAddressRate(address: string, ctx: any = null) {
    let pointsToConsume = configMap.get(RateConfig.addressWeightName)?.weight || 0.1 // 10 / 0.1 = 100
    const {path} = ctx?.request || {path: '-'};
    const {ok: paid} = await checkApiKey(path, ctx?.request?.query?.apiKey || ctx?.headers['apiKey'])
    if (paid) {
        pointsToConsume /= 10;
    }
    const ip = getClientIP(ctx);
    try {
        await burstyLimiter.consume(address, pointsToConsume)
        ctx?.set(`pointsAddress`, pointsToConsume)
        ctx?.set(`address`, address)
        ctx?.set('paid', paid)
    } catch (e) {
        RateHit.sequelize && RateHit.create({ip, path: address + "@" + path}).catch()
        throw new Errors.ApiBusyError(`Too many requests for this address [${address}] path ${path} . Allow ${burstyLimiter["points"] / pointsToConsume}/s`);
    }
}

export function buildCheckAddressRateFn(addressParamName: string, callNext = false) {
    return async (ctx, next) => {
        const {[addressParamName]: addr} = ctx.request.query;
        if (addr) {
            await checkAddressRate(addr, ctx);
        }
        if (callNext) {
            return next() // for standard Koa
        }
        return ctx; // for the magic scan api '/v1'
    }
}

export async function checkApiKey(path: string, key: string, dryRun = false) {
    if (!getWeb3pay().trackerContract) {
        return {ok: false, result: {}} // not configured
    }
    if (!key) {
        return {ok: false, result: {}};
    }
    try {
        const app = getWeb3pay().appContract.address;
        const account = decodeApiKey(app, key, true);
        const vipInfo = await getVipInfo(account);
        const expireSecond = vipInfo.expireAt;
        const ret = {ok: false, result: {...vipInfo, account, app, now: Math.floor(Date.now() / 1000)}}
        // @ts-ignore
        if (expireSecond * 1000 > Date.now()) {
            ret.ok = true;
        }
        return ret;
    } catch (e) {
        console.log(`check api key fail:`, e)
        return {ok: false, result: {error: e}};
    }
}

// Free:       5 calls/second, up to 100,000 calls/day
// Standard:   20 calls/second, up to 500,000 calls/day
// Enterprise: 100 calls/second, calls/day without limit
const LEVEL_FREE = 'free';
const LEVEL_STANDARD = 'standard';
const LEVEL_ENTERPRISE = 'enterprise';

/*
insert into rate_key(apiKey,level,qps,effectiveAt,expireAt,remark,createdAt,updatedAt)
values('11223344556677889900112233445566778899001234','enterprise',100,'2023-01-01 00:00:00','2023-12-31 23:59:59','xhs', now(), now());
*/
export interface IRateKey {
    id?: number;
    apiKey: string;
    level: string; // free, standard, enterprise
    qps: number;
    effectiveAt: Date;
    expireAt: Date;
    remark: string;
}

export class RateKey extends Model<IRateKey> implements IRateKey {
    id?: number;
    apiKey: string;
    level: string;
    qps: number;
    effectiveAt: Date;
    expireAt: Date;
    remark: string;

    static register(seq: Sequelize) {
        RateKey.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
            apiKey: {type: DataTypes.STRING(64), allowNull: false, unique: true},
            level: {type: DataTypes.STRING(10), allowNull: false},
            qps: {type: DataTypes.INTEGER, allowNull: false},
            effectiveAt: {type: DataTypes.DATE, allowNull: false},
            expireAt: {type: DataTypes.DATE, allowNull: false},
            remark: {type: DataTypes.STRING(128), allowNull: false},
        }, {
            sequelize: seq,
            tableName: 'rate_key',
            timestamps: true,
        })
    }
}

let rateKeyConfig = {};

export async function loadRateKeyConfig() {
    async function repeat() {
        const list = await RateKey.findAll({raw: true});
        rateKeyConfig = lodash.keyBy(list, 'apiKey');
    }

    repeat().then(() => {
        setInterval(repeat, 10_000)
    })
}

let rateLimiterFree;
let rateLimiterStandard;
let rateLimiterEnterprise;
let rateLimiterAddress;
let rateLimiterAccount;
let rateLimiterDaily10W;
let rateLimiterDaily50W;

export async function initRateLimiters() {
    rateLimiterFree = new BurstyRateLimiter(
        new RateLimiterMemory({
            points: 5,
            duration: 1,
            keyPrefix: `api-${LEVEL_FREE}`,
        }),
        new RateLimiterMemory({
            points: 20,
            duration: 10,
            keyPrefix: `api-burst-${LEVEL_FREE}`,
        })
    );
    rateLimiterStandard = new BurstyRateLimiter(
        new RateLimiterMemory({
            points: 20,
            duration: 1,
            keyPrefix: `api-${LEVEL_STANDARD}`,
        }),
        new RateLimiterMemory({
            points: 40,
            duration: 10,
            keyPrefix: `api-burst-${LEVEL_STANDARD}`,
        })
    );
    rateLimiterEnterprise = new BurstyRateLimiter(
        new RateLimiterMemory({
            points: 6000,
            duration: 1,
            keyPrefix: `api-${LEVEL_ENTERPRISE}`,
        }),
        new RateLimiterMemory({
            points: 12000,
            duration: 10,
            keyPrefix: `api-burst-${LEVEL_ENTERPRISE}`,
        })
    );
    rateLimiterAddress = new RateLimiterMemory({
        points: 100,
        duration: 10,
        keyPrefix: `api-address`,
    });
    rateLimiterAccount = new RateLimiterMemory({
        points: 2,
        duration: 2,
        keyPrefix: `api-account`,
    });
    rateLimiterDaily10W = new RateLimiterMemory({
        points: 100000,
        duration: 86400,
        keyPrefix: `api-daily-10w`,
    });
    rateLimiterDaily50W = new RateLimiterMemory({
        points: 500000,
        duration: 86400,
        keyPrefix: `api-daily-50w`,
    });
}

export async function checkRateByLevel(ctx, next) {
    let rateLimiter;
    let rateLimiterDaily;
    const ip = getClientIP(ctx);
    const apiKey = ctx?.request?.query?.apiKey || ctx?.headers['apiKey'];

    let rateKey = ip
    let rateId = 0;
    let paid = false;
    let level = LEVEL_FREE;
    let qps = rateLimiterFree["points"];
    try {
        const resp = await checkApiKeyByLevel(undefined, apiKey);
        paid = resp.ok;
        if (paid) {
            rateKey = resp.result['account'];
            rateId = resp.result['rateId'] || rateId;
            level = resp.result['values'][lodash.findIndex(resp.result['keys'], key => key === 'level')];
            qps = resp.result['values'][lodash.findIndex(resp.result['keys'], key => key === 'qps')];
        }

        ctx?.set('ip', ip);
        ctx?.set('rate-id', rateId);
        ctx?.set('paid', paid);
        ctx?.set('level', `${level}-${qps}`);

        switch (level) {
            case LEVEL_FREE: rateLimiter = rateLimiterFree; rateLimiterDaily = rateLimiterDaily10W; break;
            case LEVEL_STANDARD: rateLimiter = rateLimiterStandard; rateLimiterDaily = rateLimiterDaily50W; break;
            case LEVEL_ENTERPRISE: rateLimiter = rateLimiterEnterprise; break;
            default: throw new Error(`Unsupported membership level ${level}`);
        }
        const pointsToConsume = Math.floor(rateLimiter['points'] / qps);
        await rateLimiter.consume(rateKey, pointsToConsume).catch(e => {e.message = 'limited';throw e;});
        // rateLimiterDaily && (await rateLimiterDaily.consume(rateKey).catch(e => {e.message = 'limitedDaily';throw e;}));

    } catch (e) {
        let msg = e.message;
        if (msg === 'limited') {
            msg = `Too many requests. Allow ${qps}/s`;
        } else if (msg === 'limitedDaily') {
            msg = `Too many requests. Allow ${rateLimiterDaily['points']}/day`;
        }
        ctx.body = {code: 429, message: msg};
        // console.log(`${ip} ${ctx?.url} rateId ${rateId} paid ${paid} level ${level} rlt ${JSON.stringify(e)} msg ${JSON.stringify(msg)}`);
        return;
    }

    await next();
}

export function checkRateByAddress(addressParamName: string) {
    return async (ctx, next) => {
        await checkRateByAddress0(addressParamName, ctx, next);
    }
}

async function checkRateByAddress0(addressParamName, ctx, next) {
    const {[addressParamName]: address} = ctx.request.query;

    let limiter = rateLimiterAddress;
    try {
        limiter = addressParamName === "account" ? rateLimiterAccount : rateLimiterAddress;
        await limiter.consume(address);
        ctx?.set(`address`, address);
    } catch (e) {
        const msg = `Too many requests. Allow ${limiter['points']}/${limiter['duration']}s`;
        ctx.body = {code: 429, message: msg};
        // console.log(`${ip} ${ctx?.url} rlt ${JSON.stringify(e)} msg ${JSON.stringify(msg)}`);
        return;
    }

    await next();
}

export async function checkApiKeyByLevel(path, apiKey: string) {
    const rateKey = rateKeyConfig[apiKey];
    if (rateKey) {
        return {
            ok: (rateKey.effectiveAt.getTime() <= Date.now() && Date.now() <= rateKey.expireAt.getTime()),
            result: {
                keys: ['level', 'qps'],
                values: [rateKey.level, rateKey.qps],
                account: apiKey.slice(-8),
                rateId: rateKey.id,
                now: Math.floor(Date.now() / 1000),
            },
        };
    }

    if (!getWeb3pay().client) {
        return {ok: false, result: {}}; // not configured
    }
    if (!apiKey) {
        return {ok: false, result: {}};
    }

    try {
        const app = getWeb3pay().appContract.address;
        const account = decodeApiKey(app, apiKey, true);
        const vipInfo = await getVipInfo(account);
        const expireSecond = vipInfo.expireAt;
        const ret = {ok: false, result: {...vipInfo, account, app, now: Math.floor(Date.now() / 1000)}};
        // @ts-ignore
        if (expireSecond * 1000 > Date.now()) {
            ret.ok = true;
            if (lodash.findIndex(ret.result['keys'], key => key === 'qps') === -1 ||
                lodash.findIndex(ret.result['keys'], key => key === 'level') === -1) {
                ret.result['keys'] = [...['level', 'qps'], ...ret.result['keys']];
                ret.result['values'] = [...[LEVEL_STANDARD, rateLimiterStandard['points']], ...ret.result['values']];
            }
        }
        return ret;

    } catch (e) {
        console.log(`check api key fail:`, e);
        return {ok: false, result: {error: e}};
    }
}
