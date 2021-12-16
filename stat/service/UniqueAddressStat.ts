process.env.TZ='UTC'
import moment = require("moment");
import {Op,fn,col} from 'sequelize'
import {RedisWrap, redisWrap} from "./RedisWrap";
import {HourlyToken, IHourlyToken} from "../model/TokenStat";
import {DailyToken} from "../model/Token";
import {Conflux, format} from "js-conflux-sdk";
import {init} from "./tool/FixDailyTokenStat";
import {patchHttpProvider} from "./common/utils";
import {PreLoader} from "./common/PreLoader";
import {CfxLog} from "js-conflux-sdk/types/rpc";
import {TokenTool} from "./tool/TokenTool";
import {makeIdV} from "../model/HexMap";
import {Measure} from "./common/Measure";
export const HOUR_UNIQUE_ADDRESS_BUCKET = 'HOUR_UNIQUE_ADDRESS_BUCKET'
export const DAY_UNIQUE_ADDRESS_BUCKET = 'DAY_UNIQUE_ADDRESS_BUCKET'
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
function buildMap(arr:{fromId:number, toId:number, contractId:number, createdAt: Date}[]) {
    if (!arr.length) {
        return {arr}
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
    return {fromMap, toMap, allMap, dt, arr}
}
async function send2redisWrap(indexBucket: string, fmt:string, key:string, contractId:number, dt:Date, ids:number[]){
    measure.count('idLength', ids.length)
    const timestamp = dt.getTime()
    const setKey = await measure.call('buildKey', ()=>Promise.resolve(buildRedisKey(fmt, key, contractId, dt)))
    // keep keys and their time. move statistics to DB later.
    // zset, should keep the min timestamp.
    // https://redis.io/commands/zadd
    return measure.call('two-key', ()=>Promise.all([
        measure.call('addAllKey', ()=>redisWrap.zadd(indexBucket, 'NX', timestamp, setKey)),
        // add ids to each bucket.
        measure.call('saddm', ()=>RedisWrap.saddm(setKey, ids)),
    ]).then(res=>{
    }))
}
export async function handleUniqueAddress({fromMap,toMap,allMap,dt}) {
    if (!allMap || 1) {
        return
    }
    //
    async function send2redis(map:Map<number, Set<number>>, key: string) {
        const tasks = []
        const build = ()=> {
            for (let entry of map.entries()) {
                const [contractId, addressIds] = entry;
                // add to hour set and day set
                const ids = [...addressIds]
                tasks.push(send2redisWrap(HOUR_UNIQUE_ADDRESS_BUCKET, HOUR_FMT, key, contractId, dt, ids))
                tasks.push(send2redisWrap(DAY_UNIQUE_ADDRESS_BUCKET, DAY_FMT, key, contractId, dt, ids))
            }
        }
        await measure.call('buildTask', ()=>Promise.resolve(build()));
        return measure.call('all-task', ()=>Promise.all(tasks).then(()=>{
        }))
    }
    return measure.call('call-3m', ()=>Promise.all([
        measure.call('from', ()=>send2redis(fromMap, 'from')),
        measure.call('to', ()=>send2redis(toMap, 'to')),
        measure.call('all', ()=>send2redis(allMap, 'all')),
    ]).then(()=>{
        // console.log(`==========006 \n\n\n`)
    }))
}
export async function persist2db(indexBucket:string, hoursAgo: number) {
    let has;
    do {
        has = await persist2dbOne(indexBucket, hoursAgo)
    } while(has)
}
export async function persist2dbOne(indexBucket:string, hoursAgo: number) {
    // find max time. we may under catchup mode, the max time is not current time.
    const [maxKey, maxTime] = await redisWrap.zrevrangebyscore(indexBucket,
        new Date('5050').getTime(), 0, 'WITHSCORES', 'LIMIT', 0, 1)
    if (!maxKey) {
        console.log(` there is no key in redis.`)
        return;
    }
    const earlier = maxTime - 3600_1000 * hoursAgo;
    // fetch keys before some time gap.
    const [minKey, minTime] = await redisWrap.ZRANGEBYSCORE(indexBucket,
        0, earlier, 'WITHSCORES', 'LIMIT', 0, 1)
    if (!minKey) {
        console.log(` no keys. max time ${maxTime}, max key ${maxKey}, want before ${earlier
        }, ${new Date(earlier).toISOString()}`)
        // check the minimum one.
        const [minKey2, minTime2] = await redisWrap.ZRANGEBYSCORE(indexBucket,
            0, maxTime, 'WITHSCORES', 'LIMIT', 0, 1)
        console.log(` the minimum one ${minKey2} with time [${minTime2}]`)
        console.log(` time is  ${new Date(Number(minTime2)).toISOString()}`)
        return;
    }
    console.log(` max ${maxKey} min ${minKey}`)
    let key = minKey
        const count = await redisWrap.scard(key)

        const {dt, side, contractId} = parseKey(key)
        console.log(`unique address stat in redis: ${key}, ${dt.toISOString()}, ${side}, contract [${contractId}], count ${count}`)
        let prop = {'from':'uniqueSender','to':'uniqueReceiver', all:'participants'}[side]

    if (indexBucket === HOUR_UNIQUE_ADDRESS_BUCKET){
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
    } else {
        await saveDailyUnique({dayStart: dt, prop, count, hexId:contractId})
    }
    await redisWrap.del(key)
    await redisWrap.zrem(indexBucket, key)
    console.log(` ------- finish this key ${key} --------`)
    // process more records.
    return true
}
// rollup daily.
export async function saveDailyUnique({dayStart, hexId, prop, count}) {
        const [cnt] = await DailyToken.update({
            [prop]: count,
        }, {where: {
                hexId, day: dayStart, [prop]: {[Op.lt]: count}
            }, limit: 1})
        let op = ''
        if (cnt) {
            op = 'update'
        } else {
            // create it. use bulkCreate to control updateOnDuplicate. upsert do not support updateOnDuplicate.
            const bean = {
                hexId,
                day: dayStart,
                uniqueSender : 0,
                uniqueReceiver: 0,
                participants : 0,
                transferAmount: '0', transferCount: 0, holderCount: 0,
            };
            bean[prop] = count
            await DailyToken.bulkCreate([bean], {
                updateOnDuplicate: [prop]
            })
            op = 'create'
        }
        //
        console.log(` [${op}] daily unique address for ${hexId
        }, day ${dayStart.toISOString().substr(0, 10)} ${prop} = ${count}`)
}

export async function clean(indexBucket = '', force = false) {
    const [,,cmd, zSetKeyArg] = process.argv
    if (force) {
    } else if (cmd !=='clean') {
        return;
    }
    const zSetKey = indexBucket || zSetKeyArg
    let size = await redisWrap.zcard(zSetKey);
    console.log(` ${zSetKey} size ${size}`)
    do {
        if (size === 0) {
            break;
        }
        const [maxKey, maxTime] = await redisWrap.zrevrangebyscore(zSetKey,
            new Date('5050').getTime(), 0, 'WITHSCORES', 'LIMIT', 0, 1)
        await redisWrap.del(maxKey)
        await redisWrap.zrem(zSetKey, maxKey)
        console.log(` remove ${maxKey}`)
        size --
    } while (true)
    !force && process.exit(0)
}
const measure = new Measure()
const addrMap = new Map<string, string>()
const addrIdMap = new Map<string, number>()
async function polishLogs(logs:CfxLog[], epoch:number, tokenTool: TokenTool, epochTime:Date) {
    // console.log(` epoch ${epoch} logs length ${logs.length}`)
    if (logs.length === 0) {
        return []
    }
    const filtered = []
    for (let log of logs) {
        if (log.topics.length < 3) {
            // at least, topic contains [ topic, from, to]
            continue;
        }
        const {address, topics: [t, t1, t2, t3]} = log
        // console.log(`${address} ${t}`)
        if (t1 === undefined || t2 === undefined) {
            console.log(` invalid topics at epoch ${epoch
            }, block ${log.blockHash} tx ${log.transactionHash
            }, tx log index ${log.transactionLogIndex} `, log.topics)
            continue
        }
        let from, to;
        const fn = ()=> {
            if (t === tokenTool.contract.TransferSingle.signature
                || t === tokenTool.contract.TransferBatch.signature) {
                if (t3) { // t2 has been checked above.
                    from = `0x${t2.slice(-40)}`
                    to = `0x${t3.slice(-40)}`
                }
            } else {
                from = `0x${t1.slice(-40)}`
                to = `0x${t2.slice(-40)}`
            }
        }
        await measure.call('parseLog', () => Promise.resolve(fn()));
        // console.log(log)
        const contractHex = measure.execute('fmtAddr', ()=>{
            let hex = addrMap.get(address)
            if (hex) {
                return hex;
            }
            hex = format.hexAddress(address);
            addrMap.set(address, hex)
        });
        const addr2id = async (hex)=>{
            const id = addrIdMap.get(hex)
            if (id) {
                return id;
            }
            return makeIdV(hex, undefined, epochTime).then(id=>{
                addrIdMap.set(hex, id)
                return id;
            });
        }
        const [contractId, fromId, toId] = await measure.call('makeId',
            ()=> Promise.all([
                addr2id(contractHex),
                addr2id(from),
                addr2id(to),
                ])
        )
        measure.execute('set prop', ()=>{
        log['contractId'] = contractId;
        log['fromId'] = fromId
        log['toId'] = toId
        log['createdAt'] = epochTime
        filtered.push(log)
        })
    }
    return filtered;
}
async function run(cfx:Conflux, fromEpoch:number) {
    const tokenTool = new TokenTool(cfx);
    const topics = [[
        tokenTool.contract.Transfer.signature,
        tokenTool.contract.TransferBatch.signature,
        tokenTool.contract.TransferSingle.signature,
    ]]
    async function getLogs(epochNumber) : Promise<any>{
        const [block, logs] = await measure.call('rpc', ()=> Promise.all([
            measure.call(false, ()=>cfx.getBlockByEpochNumber(epochNumber, false)),
            measure.call(false, ()=>cfx.getLogs({fromEpoch: epochNumber, toEpoch: epochNumber, topics})),
        ]))
        const dt = new Date(block.timestamp * 1000)
        // return {arr:[{createdAt:dt}]};
        return measure.call('polishLogs',()=>polishLogs(logs, epochNumber, tokenTool, dt)).then(logs=>{
            return measure.call('buildMap', ()=>Promise.resolve(buildMap(logs as any)))
        })
    }
    const loader = new PreLoader(cfx, getLogs, 10000);
    loader.preLoadSize = 5
    let epoch = fromEpoch;//await cfx.getEpochNumber().then(res=> res - 1000)
    let hourMark = -1
    async function repeat() {
        const {action, data} = loader.get(epoch)
        let delay = 0
        switch (action) {
            case "ok":
                const transfers:any = await data;
                if (transfers.arr?.length) {
                    await measure.call('handle', () => handleUniqueAddress(transfers))
                }
                const log = epoch % 10 === 0
                const [sample] = transfers.arr
                if (!log) {
                    // skip
                } else if (sample) {
                    const epochHour = sample.createdAt.getHours();
                    console.log(`${new Date().toISOString()} sample transfer at epoch ${epoch} hour ${epochHour}, contract ${sample.contractId} : ${sample.fromId} -> ${sample.toId
                    }, preload size ${loader.data.size}, epoch time ${sample.createdAt.toISOString()} transfer count ${transfers.arr.length}`)
                    if (epochHour !== hourMark) {
                        console.log(`----------------- hourly event begin  ----------- ${epochHour}`)
                        await persist2db(HOUR_UNIQUE_ADDRESS_BUCKET, 2)
                        await persist2db(DAY_UNIQUE_ADDRESS_BUCKET, 24)
                        console.log(`----------------- hourly event finish ----------- ${epochHour}`)
                        // await rollupDailyUnique()
                        hourMark = epochHour
                    }
                } else {
                    console.log(` no transfer at ${epoch}`)
                }
                if (epoch % 10 === 0) {
                    measure.dump(`\n --`, undefined,'handle', 'addAllKey', 'saddm', 'idLength');
                    loader.dumpMetrics(` --------------- get logs metrics `)
                }
                epoch++
                break;
            case "pop":
                console.log(`pop ${epoch}`);
                epoch --
                break;
            case "wait":
                console.log(`wait for ${epoch}`)
                delay = 500
                break;
        }
        setTimeout(repeat, delay)
    }
    repeat().then()
}
async function benchmark() {
    const [,,cmd, timesStr] = process.argv
    if (cmd !== 'benchmark') {
        return
    }
    const times = parseInt(timesStr || '1000' );
    const k = 'delIt';
    const kSet = 'delItSet';
    await redisWrap.del(k)
    const dt = new Date()
    const start = Date.now()
    for (let i = 0; i < times; i++) {
        const rnd = Math.round(Math.random() * 1000)
        const m = buildMap([{fromId:rnd, toId: rnd+1, contractId: rnd, createdAt: new Date()}])
        await measure.call('handle', ()=> handleUniqueAddress(m as any));
        // await send2redisWrap(k, HOUR_FMT, kSet, i, dt, [800000+i])
    }
    const ms = Date.now() - start
    await clean(DAY_UNIQUE_ADDRESS_BUCKET, true);
    await clean(HOUR_UNIQUE_ADDRESS_BUCKET, true);
    console.log(`times ${times}, avg ${(ms / times).toPrecision(5)}`)
    measure.dump(`----`)
    process.exit(0);
}
async function setup(cfxUrl:string, fromEpoch = '30495305') {
    const config = await init();
    await RedisWrap.connect(config.redis)
    console.log(`--------------------`)
    await benchmark();
    await clean();
    const cfxOp = cfxUrl ? {url: cfxUrl} : config.conflux
    let cfx = new Conflux(config.conflux)
    patchHttpProvider(cfx, cfxOp)
    const st = await cfx.getStatus()
    console.log(` ${process.argv[1]} \n network ${st.networkId}`)
    return run(cfx, parseInt(fromEpoch))
}
const [,,cfxUrl,fromEpoch] = process.argv
setup(cfxUrl, fromEpoch).then().catch(err=>{
    console.log(`${process.argv[1]}\n`, err)
    process.exit(1)
})