process.env.TZ='UTC'
import moment = require("moment");
import {Op,fn,col} from 'sequelize'
import {RedisWrap, redisWrap} from "./RedisWrap";
import {HourlyToken, IHourlyToken} from "../model/TokenStat";
import {KV, UNIQUE_ADDR_DATE_MARK} from "../model/KV";
import {DailyToken} from "../model/Token";
import {Conflux, format} from "js-conflux-sdk";
import {init} from "./tool/FixDailyTokenStat";
import {patchHttpProvider} from "./common/utils";
import {PreLoader} from "./common/PreLoader";
import {CfxLog} from "js-conflux-sdk/types/rpc";
import {TokenTool} from "./tool/TokenTool";
import {makeIdV} from "../model/HexMap";
import {Measure} from "./common/Measure";
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
export async function handleUniqueAddress({fromMap,toMap,allMap,dt}) {
    if (!allMap) {
        return
    }
    //
    async function send2redisWrap(fmt:string, key:string, contractId:number, timestamp:number, ids:number[]){
        const keyH = buildRedisKey(fmt, key, contractId, dt)
        // keep keys and their time. move statistics to DB later.
        // zset, should keep the min timestamp.
        // https://redis.io/commands/zadd
        return Promise.all([
            measure.call('addAllKey', ()=>redisWrap.zadd(ALL_UNIQUE_ADDRESS_BUCKET, 'NX', timestamp, keyH)),
        // add ids to each bucket.
            measure.call('saddm', ()=>RedisWrap.saddm(keyH, ids)),
        ])
    }
    async function send2redis(map:Map<number, Set<number>>, key: string) {
        const tasks = []
        for (let entry of map.entries()) {
            const [contractId, addressIds] = entry;
            // add to hour set and day set
            const ids = [...addressIds]
            tasks.push(send2redisWrap(HOUR_FMT, key, contractId, dt.getTime(), ids).then())
            tasks.push(send2redisWrap(DAY_FMT, key, contractId, dt.getTime(), ids).then())
        }
        return Promise.all(tasks)
    }
    await Promise.all([
        send2redis(fromMap, 'from'),
        send2redis(toMap, 'to'),
        send2redis(allMap, 'all'),
    ])
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
export async function rollupDailyUnique() {
    // calculate from earliest time to latest time, and then delete earliest ones.
    const preDateMark =  await KV.getString(UNIQUE_ADDR_DATE_MARK, '2020-10-28')
    const preDate = new Date(preDateMark)
    const newDay = new Date(preDate)
    newDay.setDate(newDay.getDate()+1)
    console.log(` mark ${preDateMark} pre date ${preDate.toISOString()} new day ${newDay.toISOString()}`)

    const [preOne, newDayOne, maxOne, ] = await Promise.all([
        HourlyToken.findOne({order:[['createdAt','asc']],
            where: {createdAt:{[Op.gte]: preDate}}
        }),
        HourlyToken.findOne({order:[['createdAt','asc']],
            where: {createdAt:{[Op.gte]: newDay}}
        }),
        HourlyToken.findOne({order:[['createdAt','desc']]}),
    ])
    if (maxOne === null) {
        console.log(` min hourly record not found, table is empty.`)
        return
    }
    let timeForThisRound = preDate;
    // keep hourly records for 8 days.
    if (newDayOne !== null) {
        // records for new day show up. this will move day position.
        timeForThisRound = newDayOne.createdAt
        console.log(` use next day`)
    } else if (preOne === null) {
        console.log(` new records not ready, want after ${preDateMark}`)
        return
    } else if (maxOne.createdAt.getTime() - 3600_000 > newDay.getTime()) {
        // move forward
        timeForThisRound = newDay;
    } else {
        // update current day's stat.
        timeForThisRound = preOne.createdAt
        console.log(` repeat day`)
    }
    console.log(`hourly stat time, pre ${preOne?.createdAt.toISOString()
    }, next day ${newDayOne?.createdAt.toISOString()}, max ${maxOne?.createdAt.toISOString()}, mark position ${preDateMark}`)
    const dayStart = new Date(timeForThisRound)
    dayStart.setHours(0,0,0,0)
    const dayEnd = new Date(timeForThisRound)
    dayEnd.setHours(23,59,59,999);
    const groupByContract  = await HourlyToken.findAll({
        where: {createdAt: {[Op.between]: [dayStart, dayEnd]}},
        raw: true,
        attributes: [
            [fn('sum',col('uniqueReceiver')), 'uniqueReceiver'],
            [fn('sum',col('uniqueSender')), 'uniqueSender'],
            [fn('sum',col('participants')), 'participants'],
            'hexId',
        ],
        group: ['hexId'],
    })
    for (let hourlyToken of groupByContract) {
        const [cnt] = await DailyToken.update({
            uniqueSender: hourlyToken.uniqueSender,
            uniqueReceiver: hourlyToken.uniqueReceiver,
            participants: hourlyToken.participants,
        }, {where: {
                hexId: hourlyToken.hexId, day: dayStart
            }, limit: 1})
        let op = ''
        if (cnt) {
            op = 'update'
        } else {
            // create it. use bulkCreate to control updateOnDuplicate. upsert do not support updateOnDuplicate.
            await DailyToken.bulkCreate([{
                hexId: hourlyToken.hexId,
                day: dayStart,
                uniqueSender: hourlyToken.uniqueSender,
                uniqueReceiver: hourlyToken.uniqueReceiver,
                participants: hourlyToken.participants,
                transferAmount: '0', transferCount: 0, holderCount: 0,
            }], {updateOnDuplicate: ['uniqueSender','uniqueReceiver','participants']})
            op = 'create'
        }
        //
        await KV.upsert({key: UNIQUE_ADDR_DATE_MARK, value: dayStart.toISOString().substr(0, 10)})
        console.log(` [${op}] daily unique address for ${hourlyToken.hexId
        }, day ${dayStart.toISOString().substr(0, 10)} uniqueSender ${hourlyToken.uniqueSender} uniqueReceiver ${hourlyToken.uniqueReceiver
        } participants ${hourlyToken.participants}`)
    }
}

const measure = new Measure()
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
        const {address,topics:[t,t1,t2,t3]} = log
        // console.log(`${address} ${t}`)
        if (t1 === undefined || t2 === undefined) {
            console.log(` invalid topics at epoch ${epoch
            }, block ${log.blockHash} tx ${log.transactionHash
            }, tx log index ${log.transactionLogIndex} `, log.topics)
            continue
        }
        let from, to;
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
        // console.log(log)
        const contractHex = format.hexAddress(address)
        const [contractId, fromId, toId] = await measure.call('makeId',
            ()=> Promise.all([
                    makeIdV(contractHex, undefined, epochTime),
                    makeIdV(from, undefined, epochTime),
                    makeIdV(to, undefined, epochTime),
                ])
        )
        log['contractId'] = contractId;
        log['fromId'] = fromId
        log['toId'] = toId
        log['createdAt'] = epochTime
        filtered.push(log)
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
            measure.call('getBlocks', ()=>cfx.getBlockByEpochNumber(epochNumber, false)),
            measure.call('getLogs', ()=>cfx.getLogs({fromEpoch: epochNumber, toEpoch: epochNumber, topics})),
        ]))
        const dt = new Date(block.timestamp * 1000)
        return measure.call('polishLog',()=>polishLogs(logs, epochNumber, tokenTool, dt)).then(logs=>{
            return measure.call('buildMap', ()=>Promise.resolve(buildMap(logs as any)))
        })
    }
    const loader = new PreLoader(cfx, getLogs, 10000);
    loader.preLoadSize = 100
    let epoch = fromEpoch;//await cfx.getEpochNumber().then(res=> res - 1000)
    let hourMark = -1
    async function repeat() {
        const {action, data} = loader.get(epoch)
        let delay = 0
        switch (action) {
            case "ok":
                const transfers:any = await data;
                await measure.call('handle', ()=>handleUniqueAddress(transfers))
                const log = epoch % 10 === 0
                const [sample] = transfers.arr
                if (!log) {
                    // skip
                } else if (sample) {
                    const epochHour = sample.createdAt.getHours();
                    console.log(`${new Date().toISOString()} sample transfer at epoch ${epoch} hour ${epochHour}, contract ${sample.contractId} : ${sample.fromId} -> ${sample.toId
                    }, preload size ${loader.data.size}, epoch time ${sample.createdAt.toISOString()} transfer count ${transfers.arr.length}`)
                    if (epochHour !== hourMark) {
                        console.log(`----------------- hourly event ----------- ${epochHour}`)
                        await persist2db()
                        await rollupDailyUnique()
                        hourMark = epochHour
                    }
                } else {
                    console.log(` no transfer at ${epoch}`)
                }
                if (epoch % 100 === 0) {
                    loader.dumpMetrics(` --------------- get logs metrics `)
                    measure.dump(` --`, undefined,'handle', 'addAllKey', 'saddm');
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
    if (!process.argv.includes('benchmark')) {
        return
    }
    const times = 1000
    const k = 'delIt';
    const kSet = 'delItSet';
    await redisWrap.del(k)
    const start = Date.now()
    for (let i = 0; i < times; i++) {
        await redisWrap.zadd(k, 'NX', 1, 'a')
        await redisWrap.sadd(kSet, [1,2,3,4,5])
    }
    const ms = Date.now() - start
    console.log(`times ${times}, avg ${(ms / times).toPrecision(5)}`)
    await redisWrap.del(k)
    await redisWrap.del(kSet)
    process.exit(0);
}
async function setup(cfxUrl:string, fromEpoch = '30495305') {
    const config = await init();
    await RedisWrap.connect(config.redis)
    console.log(`--------------------`)
    await benchmark();
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