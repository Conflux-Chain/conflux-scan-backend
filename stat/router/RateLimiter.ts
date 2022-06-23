import {Sequelize, fn, col, Op, QueryTypes, Model, DataTypes, literal} from 'sequelize'
import {RateLimiterMemory, BurstyRateLimiter} from 'rate-limiter-flexible'
//
export interface IRateConfig {
    id?:number;
    name:string; weight:number;
}
export class RateConfig extends Model<IRateConfig> implements IRateConfig{
    static defaultWeightName = 'defaultWeight'
    static contractWeightName = 'contract'
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

export async function loadRateConfig() {
    const list = await RateConfig.findAll()
    list.forEach(c=>{
        configMap.set(c.name, c)
    })
    if (!list.length) {
        RateConfig.bulkCreate([
            {name: RateConfig.defaultWeightName, weight: 1},
            {name: RateConfig.contractWeightName, weight: 0.1}
        ]).then()
    }
}
if (RateConfig.sequelize) {
    setInterval(loadRateConfig, 10_000)
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
export async function checkContractRate(contract:string, ctx:any = {}) {
    let pointsToConsume = configMap.get(RateConfig.contractWeightName)?.weight || 0.1 // 10 / 0.1 = 100
    const {ip, path} = ctx.request || {};
    try {
        await burstyLimiter.consume(contract, pointsToConsume)
        ctx.set(`pointsContract`, pointsToConsume)
        ctx.set(`contract`, contract)
    } catch (e) {
        console.log(`rate limit contract ${contract}, ip ${ip}`)
        RateHit.sequelize && RateHit.create({ip, path:contract+"@"+path}).catch()
        throw new Error(`Too many requests for this contract. Allow ${burstyLimiter["points"] / pointsToConsume}/s}`)
    }
}
export async function checkRate(ctx,next) {
    const {ip, path} = ctx.request;
    const key = ip
    // resources like nftPreview should have a small weight like 0.01.
    let pointsToConsume = configMap.get(path)?.weight || configMap.get(RateConfig.defaultWeightName)?.weight || 1
    try {
        await burstyLimiter.consume(key, pointsToConsume)
        ctx?.set(`pointsIP`, pointsToConsume)
        ctx?.set(`IP`, ip)
    } catch (e) {
        console.log(` rate limit ${ip} for ${path}, key ${key}`)
        RateHit.sequelize && RateHit.create({ip, path}).catch()
        // ctx.status = 600
        ctx.body = {code: 429, message:`Too many requests. Allow ${burstyLimiter["points"] / pointsToConsume}/s`}
        return
    }
    await next()
}