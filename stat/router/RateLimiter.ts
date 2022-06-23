import {StatApp} from "../StatApp";

const requestIp = require('request-ip');
import {Sequelize, fn, col, Op, QueryTypes, Model, DataTypes, literal} from 'sequelize'
import {RateLimiterMemory, BurstyRateLimiter} from 'rate-limiter-flexible'
import {format} from "js-conflux-sdk";
//
export interface IRateConfig {
    id?:number;
    name:string; weight:number;
}
export class RateConfig extends Model<IRateConfig> implements IRateConfig{
    static defaultWeightName = 'defaultWeight'
    static addressWeightName = 'address'
    id?:number;
    name:string; weight:number;
    static register(seq:Sequelize) {
        RateConfig.init({
          id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
          name: {type: DataTypes.STRING(256), allowNull: false, unique: true},
          weight: {type: DataTypes.FLOAT, allowNull: false},
        }, {
            sequelize: seq, tableName: 'rate_config',
        })
    }
}
//
export interface IRateHit {
    id?:number; ip:string; path:string
}
export class RateHit extends Model<IRateHit> implements IRateHit{
    id?:number; ip:string; path:string
    static register(seq:Sequelize) {
        RateHit.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
            ip: {type: DataTypes.STRING(64), allowNull: false},
            path: {type: DataTypes.STRING(256), allowNull: false},
        }, {
            sequelize: seq, tableName: 'rate_hit',
        })
    }
}
//
const configMap = new Map<string, IRateConfig>();
['/open/nft/preview','/stat/nft/checker/preview'].forEach(name=>{
    configMap.set(name, {name, weight: 0.01})
})
let timer;
export async function loadRateConfig() {
    const list = await RateConfig.findAll()
    list.forEach(c=>{
        configMap.set(c.name, c)
    })
    if (!list.length) {
        RateConfig.bulkCreate([
            {name: RateConfig.defaultWeightName, weight: 1},
            {name: RateConfig.addressWeightName, weight: 0.1}
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
export function buildCheckAddressRateFn(addressParamName:string) {
    return async (options, ctx)=>{
        const {[addressParamName]:addr} = ctx.request;
        console.log(`------ options`, options)
        console.log(`------ ctx`, ctx)

        console.log(`path ${ctx.path} addr ${addr}`)
        if (addr) {
            await checkAddressRate(addr, ctx);
        }
        return options
    }
}
export async function checkAddressRate(address:string, ctx:any = null) {
    let pointsToConsume = configMap.get(RateConfig.addressWeightName)?.weight || 0.1 // 10 / 0.1 = 100
    const {path} = ctx?.request || {path:'-'};
    const ip = requestIp.getClientIp(ctx?.request || {}) || '-';
    try {
        await burstyLimiter.consume(address, pointsToConsume)
        ctx?.set(`pointsAddress`, pointsToConsume)
        ctx?.set(`address`, address)
    } catch (e) {
        console.log(`rate limit address ${address}, ip ${ip}, points ${pointsToConsume} path ${path}`, e)
        RateHit.sequelize && RateHit.create({ip, path:address+"@"+path}).catch()
        let hex = address;
        let base32 = address;
        try {
            hex = format.hexAddress(address);
            base32 = format.address(hex, StatApp.networkId);
        } catch (e) {
        }
        const error = new Error(`Too many requests for this address hex [${hex}] base32 [${base32}]. Allow ${burstyLimiter["points"] / pointsToConsume}/s}`);
        error['status'] = error['code'] = 429
        throw error
    }
}
export async function checkRate(ctx,next) {
    const {path} = ctx.request;
    const ip = requestIp.getClientIp(ctx.request);
    const key = ip
    // resources like nftPreview should have a small weight like 0.01.
    let pointsToConsume = configMap.get(path)?.weight || configMap.get(RateConfig.defaultWeightName)?.weight || 1
    try {
        await burstyLimiter.consume(key, pointsToConsume)
        ctx?.set(`pointsIP`, pointsToConsume)
        ctx?.set(`IP`, ip)
    } catch (e) {
        console.log(` rate limit ${ip} for ${path}, key ${key} points ${pointsToConsume}`, e)
        RateHit.sequelize && RateHit.create({ip, path}).catch()
        // ctx.status = 600
        ctx.body = {code: 429, message:`Too many requests. Allow ${burstyLimiter["points"] / pointsToConsume}/s`}
        return
    }
    await next()
}