import moment = require("moment");
import {RedisWrap, redisWrap} from "./RedisWrap";
export const ALL_UNIQUE_ADDRESS_BUCKET = 'ALL_UNIQUE_ADDRESS_BUCKET'
const HOUR_FMT = 'YYYY-MM-DD HH:00:00'
const DAY_FMT = 'YYYY-MM-DD'

function parseKey(key:string) {
    const [dt, contractId] = key.split('_')
    return {dt: new Date(dt), contractId}
}
async function buildRedisKey(fmt:string, id:number, dt:Date) {
    return `${moment(dt).format(fmt)}_${id}_token_unique_addr`
}
async function handleUniqueAddress(arr:{fromId:number, toId:number, contractId:number, createdAt: Date}[]) {
    if (!arr.length) {
        return
    }
    const dt = arr[0].createdAt
    function push(map:Map<number, number[]>, key:number, v: number) {
        let arr = map.get(key)
        if (!arr) {
            arr = []
            map.set(key, arr)
        }
        arr.push(v)
    }
    const fromMap = new Map<number, number[]>()
    const toMap = new Map<number, number[]>()
    for (let transfer of arr) {
        push(fromMap, transfer.contractId, transfer.fromId)
        push(toMap, transfer.contractId, transfer.toId)
    }
    //
    async function send2redisWrap(fmt:string, contractId:number, timestamp:number, ids:any[]){
        const keyH = buildRedisKey(fmt, contractId, dt)
        await RedisWrap.zadd(ALL_UNIQUE_ADDRESS_BUCKET, dt.getTime(), keyH)
        await RedisWrap.saddm(keyH, ids)
    }
    async function send2redis(map:Map<number, number[]>) {
        for (let entry of map.entries()) {
            const [contractId, addressIds] = entry;
            // add to hour set and day set
            send2redisWrap(HOUR_FMT, contractId, dt.getTime(), addressIds).then();
            send2redisWrap(DAY_FMT, contractId, dt.getTime(), addressIds).then();
        }
    }
    await send2redis(fromMap)
    await send2redis(toMap)
}
async function persist2db() {
    const now = Date.now()
    const earlier = now - 3600_1000;
    const keys:any[] = await redisWrap.zrange(0, earlier, 'BYSCORE', 1)
    if (!keys.length) {
        console.log(` no keys. `)
    }
    for (let key of keys) {
        const count = await redisWrap.zcard(key)
        const {dt, contractId} = parseKey(key)
        console.log(`${key}, ${dt}, ${contractId}, count ${count}`)
    }
}