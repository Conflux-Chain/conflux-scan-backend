import moment = require("moment");
import {Op} from 'sequelize'
import {RedisWrap, redisWrap} from "./RedisWrap";
import {HourlyToken, IHourlyToken} from "../model/TokenStat";
export const ALL_UNIQUE_ADDRESS_BUCKET = 'ALL_UNIQUE_ADDRESS_BUCKET'
const HOUR_FMT = 'YYYY-MM-DD HH:00:00'
const DAY_FMT = 'YYYY-MM-DD'

function parseKey(key:string) {
    const [dt, side, contractId] = key.split('_')
    return {dt: new Date(dt), side, contractId:parseInt(contractId)}
}
// compose time,  key[from/to] and contract id
function buildRedisKey(fmt:string, key:string, id:number, dt:Date) {
    return `${moment(dt).format(fmt)}_${key}_${id}_tokenUniqueAddr`
}
// assume that all records are within one epoch, so they have same time.
export async function handleUniqueAddress(arr:{fromId:number, toId:number, contractId:number, createdAt: Date}[]) {
    if (!arr.length) {
        return
    }
    const dt = arr[0].createdAt
    function push(map:Map<number, Set<number>>, key:number, v: number) {
        let arr = map.get(key)
        if (!arr) {
            arr = new Set<number>()
            map.set(key, arr)
        }
        arr.add(v)
    }
    // distinguish from/sender and to/receiver.
    const fromMap = new Map<number, Set<number>>()
    const toMap = new Map<number, Set<number>>()
    const allMap = new Map<number, Set<number>>()
    for (let transfer of arr) {
        push(fromMap, transfer.contractId, transfer.fromId)
        push(toMap, transfer.contractId, transfer.toId)

        push(allMap, transfer.contractId, transfer.fromId)
        push(allMap, transfer.contractId, transfer.toId)
    }
    //
    async function send2redisWrap(fmt:string, key:string, contractId:number, timestamp:number, ids:Set<number>){
        const keyH = buildRedisKey(fmt, key, contractId, dt)
        // keep keys and their time. move statistics to DB later.
        // zset, should keep the min timestamp.
        // https://redis.io/commands/zadd
        await redisWrap.zadd(ALL_UNIQUE_ADDRESS_BUCKET, 'NX', timestamp, keyH)
        // add ids to each bucket.
        await RedisWrap.saddm(keyH, [...ids])
    }
    async function send2redis(map:Map<number, Set<number>>, key: string) {
        for (let entry of map.entries()) {
            const [contractId, addressIds] = entry;
            // add to hour set and day set
            await send2redisWrap(HOUR_FMT, key, contractId, dt.getTime(), addressIds).then();
            await send2redisWrap(DAY_FMT, key, contractId, dt.getTime(), addressIds).then();
        }
    }
    await send2redis(fromMap, 'from')
    await send2redis(toMap, 'to')
    await send2redis(allMap, 'all')
}
export async function persist2db() {
    // find max time. we may under catchup mode, the max time is not current time.
    const [maxKey, maxTime] = await redisWrap.zrevrangebyscore(ALL_UNIQUE_ADDRESS_BUCKET,
        new Date('5050').getTime(), 0, 'WITHSCORES', 'LIMIT', 0, 1)
    if (!maxKey) {
        console.log(` there is no key in redis.`)
        return;
    }
    const earlier = maxTime - 3600_1000;
    // fetch keys before some time gap.
    const [minKey, minTime] = await redisWrap.ZRANGEBYSCORE(ALL_UNIQUE_ADDRESS_BUCKET,
        0, earlier, 'WITHSCORES', 'LIMIT', 0, 1)
    if (!minKey) {
        console.log(` no keys. max time ${maxTime}, max key ${maxKey}, want before ${earlier
        }, ${new Date(earlier).toISOString()}`)
        // check the minimum one.
        const [minKey2, minTime2] = await redisWrap.ZRANGEBYSCORE(ALL_UNIQUE_ADDRESS_BUCKET,
            0, maxTime, 'WITHSCORES', 'LIMIT', 0, 1)
        console.log(` the minimum one ${minKey2} with time [${minTime2}]`)
        console.log(` time is  ${new Date(Number(minTime2)).toISOString()}`)
        return;
    }
    console.log(` max ${maxKey} min ${minKey}`)
    let key = minKey
    {
        const count = await redisWrap.scard(key)

        const {dt, side, contractId} = parseKey(key)
        console.log(`unique address stat in redis: ${key}, ${dt.toISOString()}, ${side}, contract [${contractId}], count ${count}`)
        let prop = {'from':'uniqueSender','to':'uniqueReceiver', all:'participants'}[side]

        const identifier = {hexId: contractId, createdAt: dt}
        const dbBean = await HourlyToken.findOne({where: identifier})
        if (dbBean === null) {
            const template:IHourlyToken = {
                createdAt: dt, hexId: contractId, participants: 0, uniqueReceiver: 0, uniqueSender: 0,
            }
            template[prop] = count
            await HourlyToken.create(template)
            console.log(`create hourly bean for ${key}, ${prop}:${count}`)
        } else if (dbBean[prop] < count){
            await HourlyToken.update({[prop]: count}, {
                where:identifier
            })
            console.log(` update hourly bean for ${key}, ${prop}:${count}`)
        } else {
            console.log(` db has larger value ${key}, ${prop}: ${dbBean[prop]} >= ${count}`)
        }
        await redisWrap.del(key)
        await redisWrap.zrem(ALL_UNIQUE_ADDRESS_BUCKET, key)
        console.log(` ------- finish this key ${key} --------`)
    }
    return true
}
// rollup daily.
async function rollupDailyUnique() {

}