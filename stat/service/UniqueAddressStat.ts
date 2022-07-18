/**
 * Unique address for each token.
 */

process.env.TZ='UTC'
import {redirectLog} from "../config/LoggerConfig";
import {DailyTokenTxn, TOKEN_TYPE_ALL_4} from "../model/Erc20Transfer";
import {redisWrap,RedisWrap} from "./RedisWrap";
import {regExitHook, sleep} from "./tool/ProcessTool";
import {Op, fn, col, Model, Sequelize, DataTypes, literal} from 'sequelize'
import {DailyToken, IDailyToken} from "../model/Token";
import {Conflux, format} from "js-conflux-sdk";
import {init} from "./tool/FixDailyTokenStat";
import {patchHttpProvider} from "./common/utils";
import {PreLoader} from "./common/PreLoader";
import {Log as CfxLog} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {TokenTool} from "./tool/TokenTool";
import {makeIdV} from "../model/HexMap";
import {Measure} from "./common/Measure";
//
export interface IUniqueAddress {
    id?:number
    epochStart:number
    epochEnd: number
    timeStart: Date
    timeEnd: Date
    contractId:number
    addr:string
    fromMark: boolean
    toMark: boolean
}
export class UniqueAddress extends Model<IUniqueAddress> implements IUniqueAddress {
    id?:number
    // main prop
    contractId:number
    addr:string
    fromMark: boolean
    toMark: boolean
    epochStart:number // it's start epoch of the task.

    epochEnd: number
    timeStart: Date
    timeEnd: Date
    static register(seq:Sequelize) {
        UniqueAddress.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true, autoIncrement: true},
            epochStart: {type: DataTypes.BIGINT, allowNull: false, },
            epochEnd: {type: DataTypes.BIGINT, allowNull: false, },
            timeStart: {type: DataTypes.DATE, allowNull: false},
            timeEnd: {type: DataTypes.DATE, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false, },
            addr: {type: DataTypes.STRING(ADDR_LEN), allowNull: false, },
            fromMark: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            toMark: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
        }, {
            sequelize: seq, tableName: 'unique_addr', timestamps: false,
            indexes: [
                {name: 'uk_epoch_cid_addr', fields:['epochStart','contractId', 'addr']},
                {name: 'idx_timeStart', fields: ['timeStart']}
            ]
        })
    }
}
// worker takes task (epoch range), and aggregate transfer records within the epoch range, then persist to db.
export interface IEpochTask {
    epoch: number
    range: number,
    createdAt: Date,
    updatedAt: Date
    finished: boolean
}
// task epoch should be [epoch, epoch+range)
export class EpochTask extends Model<IEpochTask> implements IEpochTask{
    epoch: number
    range: number
    createdAt: Date
    updatedAt: Date
    finished: boolean
    static register(seq:Sequelize) {
        EpochTask.init({
            epoch: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true},
            range: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
            finished: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
        },{
            sequelize: seq, tableName: 'epoch_task_unique_addr',
        })
    }
}
// from epoch is from startup argument, so it's safe using it when resuming task.
export async function fetchTask(len:number, fromEpoch = 0, model = EpochTask) : Promise<IEpochTask> {
    do {
        const [maxOne, exactOne, runningOne] = await Promise.all([
            model.findOne({order:[['epoch','desc']]}),
            model.findOne({where: {epoch: fromEpoch, finished: false}}), // resume exists task
            model.findOne({where: {finished: false}}), // resume running task
        ])
        if (exactOne) {
            console.log(` resume exists task ${fromEpoch}`)
            return exactOne;
        }
        if (fromEpoch == -1) {
            if (runningOne) {
                console.log(` resume running task ${runningOne.epoch}`)
                return runningOne;
            }else {
                fromEpoch = 0
            }
        }
        let preEnd = fromEpoch;
        if (maxOne !== null) {
            preEnd = maxOne.epoch + maxOne.range
        }
        const now = new Date();
        const newOne:IEpochTask = {epoch: preEnd, range: len, finished: false, createdAt: now, updatedAt: now}
        let ok = false
        await model.create(newOne).then(()=>{
            console.log(`create task, epoch ${preEnd}`)
            ok = true
        }).catch(err=>{
            console.log(`create task fail, ${err}, try again`)
            return sleep(1000)
        })
        if (ok) {
            return newOne;
        }
    } while (true)
}

// assume that all records are within one epoch, so they have same time.
export class Aggregator<K,V> {
    allMap = new Map<K, Map<V, IUniqueAddress>>()
    buildMap(arr: { from: V, to: V, contractId: K/*, createdAt: Date */}[], epoch:number, time:Date) {
        if (!arr.length) {
            return {arr}
        }
        // const dt = arr[0].createdAt
        // distinguish from/sender and to/receiver.
        function checkEntry(addrInfoMap: Map<V, IUniqueAddress>, addr,
                            contractId) {
            let entry = addrInfoMap.get(addr);
            if (!entry) {
                entry = {contractId, addr, epochStart: epoch, epochEnd: epoch, timeStart: time,
                timeEnd: time, fromMark: false, toMark: false};
                addrInfoMap.set(addr, entry)
            } else {
                entry.epochEnd = epoch
                entry.timeEnd = time
            }
            return entry;
        }

        for (let transfer of arr) {
            const {contractId, from, to} = transfer
            let addrInfoMap = this.allMap.get(contractId);
            if (!addrInfoMap) {
                addrInfoMap = new Map<V, IUniqueAddress>();
                this.allMap.set(contractId, addrInfoMap)
            }
            let entry = checkEntry(addrInfoMap, from, contractId)
            entry.fromMark = true
            if (from !== to) {
                entry = checkEntry(addrInfoMap, to, contractId)
            }
            entry.toMark = true
        }
        return {arr}
    }
}

export async function calcDailyUniqueAddrSchedule() {
    setTimeout(()=>calcDailyUniqueAddr(), 10_000); // delay when startup.
    setTimeout(()=>calcDailyUniqueAddrSchedule(), 3600_000)// per hour.
}
export async function calcDailyUniqueAddr() {
    const dt = new Date();
    const hour = dt.getHours();
    if (hour === 1) {
        //
        const preDay = new Date(dt);
        preDay.setDate(preDay.getDate() - 1)
        await calcOneDayUniqueArr(preDay)
    }
    await calcOneDayUniqueArr(dt)
}
export async function calcDailyTokenOnChain(dt: Date) {
    console.log(`calcDailyTokenOnChain ${dt.toISOString()}`)
    const timeBegin = new Date(dt); timeBegin.setHours(0,0,0,0)
    const timeEnd = new Date(timeBegin); timeEnd.setHours(23,59,59,999);
    const transferCount = await DailyToken.sum('transferCount',{
        where: {day: dt}, raw: true,
        logging: console.log,
    }).then(res=>{
        return isNaN(res) ? 0: res;
    })
    const userCount = await UniqueAddress.count({
            distinct: true, col: 'addr',
            where: {timeStart: {[Op.between]: [timeBegin, timeEnd]}}
        },
    )
    await DailyTokenTxn.upsert({
        day: dt, txnCount: transferCount,
        userCount, type: TOKEN_TYPE_ALL_4
    })
}
export async function calcOneDayUniqueArr(dt:Date) {
    const timeBegin = new Date(dt); timeBegin.setHours(0,0,0,0)
    const timeEnd = new Date(timeBegin); timeEnd.setHours(23,59,59,999);
    const showSql = false;
    const list = await UniqueAddress.findAll(({
        attributes: [
            'contractId',
            [literal('count(distinct(if(fromMark, addr, "")))'), 'sender'],
            [literal('count(distinct(if(toMark, addr, "")))'), 'receiver'],
            [literal('count(distinct(addr))'), 'all'],
        ], raw: true, group: ['contractId'],
        where: {timeStart:{[Op.between]: [timeBegin,timeEnd]}},
        logging: showSql ? console.log : false,
    }))
    // update one by one in order to prevent db dead lock.
    for (let uniqueCount of list) {
        const bean:IDailyToken = {
            hexId: uniqueCount['contractId'], holderCount: 0, transferCount: 0, transferAmount: '0',
            day: timeBegin,
            uniqueSender: uniqueCount['sender'],
            uniqueReceiver: uniqueCount['receiver'],
            participants: uniqueCount['all'],
        }
        await DailyToken.bulkCreate([bean], {
            updateOnDuplicate: ['uniqueSender','uniqueReceiver', 'participants'],
        })
    }
    console.log(` calculate daily token unique addr done. count ${list.length}, day ${timeBegin.toISOString()}`);
    await calcDailyTokenOnChain(dt);
}
export async function topUnique({limit = 10, day = 7, showSql = false}) {
    // index on timeStart, not timeEnd.
    const maxUnique = await UniqueAddress.findOne({order:[['timeStart','desc']]})
    if (maxUnique === null) {
        if (!this.___show_log){
            console.log(` no unique address record found.`)
            this.___show_log = true;
        }
        return {list: {sender:[],receiver:[],all:[]}, timeBegin: new Date(0), maxTimeStart: new Date(0)}
    }
    let timeBegin = new Date(maxUnique.timeStart)
    timeBegin.setDate(timeBegin.getDate() - day)
    return UniqueAddress.findAll(({
        attributes: [
            'contractId',
            [literal('count(distinct(if(fromMark, addr, "")))'), 'sender'],
            [literal('count(distinct(if(toMark, addr, "")))'), 'receiver'],
            [literal('count(distinct(addr))'), 'all'],
        ], raw: true, group: ['contractId'], order: [[col('all'), 'desc']],
        where: {timeStart:{[Op.gte]: timeBegin}}, limit: limit * 6,
        logging: showSql ? console.log : false,
    })).then(list=>{
        return {list: classifyTopList(list), timeBegin, maxTimeStart: maxUnique.timeStart}
    })
}
export function classifyTopList(list:any[], len = 10) : {sender:any[], receiver:any[], all:any[]} {
    const types = {}
    function sort(prop) {
        return list.sort((a,b)=>b[prop] - a[prop])
    }
    ['sender', 'receiver', 'all'].forEach(p=>{
        types[p] = sort(p).slice(0, len).map(e=>{
            return {...e} // deep copy
        })
    })
    return types as any;
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
const ADDR_LEN = 8 // 40. only save the tail of an address.
async function polishLogs(logs:CfxLog[], epoch:number, tokenTool: TokenTool, epochTime:Date) {
    // console.log(` epoch ${epoch} logs length ${logs.length}`)
    if (logs.length === 0) {
        return []
    }
    const filtered = []
    const addrLen = -ADDR_LEN
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
        const sliceAddr = ()=> {
            if (t === tokenTool.contract.TransferSingle.signature
                || t === tokenTool.contract.TransferBatch.signature) {
                if (t3) { // t2 has been checked above.
                    from = t2.slice(addrLen)
                    to = t3.slice(addrLen)
                }
            } else {
                from = t1.slice(addrLen)
                to = t2.slice(addrLen)
            }
        }
        measure.execute('parseLog', sliceAddr);
        // console.log(log)
        const contractHex = measure.execute('fmtAddr', ()=>{
            let hex = addrMap.get(address)
            if (hex) {
                return hex;
            }
            hex = format.hexAddress(address);
            addrMap.set(address, hex)
            return hex;
        });
        const addr2id = async (hex)=>{
            const id = measure.execute('getCacheId', ()=>addrIdMap.get(hex))
            if (id) {
                return id;
            }
            return measure.call('makeId', ()=>makeIdV(hex, undefined, epochTime).then(id=>{
                addrIdMap.set(hex, id)
                return id;
            }));
        }
        const [contractId] = await measure.call('loadId',
            ()=> Promise.all([
                addr2id(contractHex),
                // addr2id(from),
                // addr2id(to),
                ])
        )
        if (!contractId) {
            console.log(`contract id is not set !, contract ${address} ${contractHex}`)
        }
        measure.execute('set prop', ()=>{
            log['contractId'] = contractId;
            log['from'] = from
            log['to'] = to
            // log['createdAt'] = epochTime
            filtered.push(log)
        });
    }
    return filtered;
}
async function saveUniqueAddrToDb(aggregator: Aggregator<number, string>, {
    epoch
}) {
    const it = aggregator.allMap.entries()
    const beanArr = []
    for (let itElement of it) {
        const [k,v] = itElement
        for (let [addr, mark] of v.entries()) {
            beanArr.push(mark)
        }
    }
    return UniqueAddress.sequelize.transaction(async (dbTx)=>{
        return Promise.all([
            UniqueAddress.bulkCreate(beanArr, {transaction: dbTx, updateOnDuplicate:['fromMark', 'toMark']}),
            EpochTask.update({finished: true}, {
                transaction: dbTx, where: {epoch}
            })
        ])
    }).then(()=>{
        console.log(` save unique address, contract count ${aggregator.allMap.size
        } addr count ${beanArr.length}`)
    })

}
const toolInfo:any = {init: true}
export function getTokenTool(cfx:Conflux) {
    if (toolInfo.init) {
        const tokenTool = new TokenTool(cfx);
        const topics = [[
            tokenTool.contract.Transfer.signature,
            tokenTool.contract.TransferBatch.signature,
            tokenTool.contract.TransferSingle.signature,
        ]]
        toolInfo.tokenTool = tokenTool
        toolInfo.topics = topics;
        toolInfo.init = false;
    }
    return toolInfo;
}
async function run(cfx:Conflux, fromEpoch:number, stopBeforeEpoch:number, endFn:()=>void) {
    const {tokenTool, topics} = getTokenTool(cfx)
    const aggregator = new Aggregator<number,string>();
    async function getLogs(epochNumber) : Promise<any>{
        const [block, logs] = await measure.call('rpc', ()=> Promise.all([
            measure.call(false, ()=>cfx.getBlockByEpochNumber(epochNumber, false)),
            measure.call(false, ()=>cfx.getLogs({
                fromEpoch: epochNumber, toEpoch: epochNumber, topics
            })).then(arr=>{
                return arr;
            }),
        ]))
        const dt = new Date(block.timestamp * 1000)
        // return {arr:[{createdAt:dt}]};
        return measure.call('polishLogs',()=>polishLogs(logs, epochNumber, tokenTool, dt)).then(logs=>{
            return measure.execute('buildMap', ()=>aggregator.buildMap(logs as any, epochNumber, dt))
        }).then(()=>{
            return {arr:logs, epochTime: dt};
        })
    }
    let timeStart, timeEnd;
    const loader = new PreLoader(cfx, getLogs, 10000, stopBeforeEpoch);
    loader.preLoadSize = 50
    let epoch = fromEpoch;//await cfx.getEpochNumber().then(res=> res - 1000)
    async function repeat() {
        const {action, data} = await loader.get(epoch)
        let delay = 0
        const epochMeasureKey = 'perEpoch';
        switch (action) {
            case "ok":
                if (data instanceof Error) {
                    console.log(`error data, epoch ${epoch}. `, data)
                    delay = 10_000 // retry.
                    break;
                }
                let transfers: any;
                try {
                    transfers = data;
                } catch (e) {
                    console.log(`error when load data, epoch ${epoch}. `, e)
                    delay = 10_000 // retry.
                    break;
                }
                const log = epoch % 100 === 0
                const {arr:[sample], epochTime} = transfers
                if (timeStart) {
                    timeEnd = epochTime
                } else {
                    timeStart = epochTime;
                }
                if (!log) {
                    // skip
                } else if (sample) {
                    const epochHour = transfers.epochTime.getHours();
                    console.log(`${new Date().toISOString()} sample transfer at epoch ${epoch} hour ${epochHour
                    }, contract ${sample.contractId
                    } : ${sample.from} -> ${sample.to
                    }, preload size ${loader.data.size}, epoch time ${transfers.epochTime.toISOString()
                    } transfer count ${transfers.arr.length}`)
                } else {
                    console.log(` no transfer at ${epoch}`)
                }
                if (epoch % 100 === 0) {
                    measure.dump(`\n --`, undefined,epochMeasureKey, 'rpc', 'polishLogs','buildMap', 'idLength');
                    loader.dumpMetrics(` --------------- get logs metrics , addr count ${addrIdMap.size}`)
                }
                epoch++
                break;
            case "pop":
                console.log(`pop ${epoch}`);
                epoch --
                break;
            case "wait":
                console.log(`wait for ${epoch}`)
                delay = 5000
                break;
        }
        if (epoch < stopBeforeEpoch) {
            setTimeout(repeat, delay)
        } else {
            console.log(` round end, [${fromEpoch}, ${stopBeforeEpoch})`)
            await saveUniqueAddrToDb(aggregator, {
                epoch: fromEpoch
            })
            endFn()
        }
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
    const aggregator = new Aggregator();
    for (let i = 0; i < times; i++) {
        const rnd = Math.round(Math.random() * 1000)
        const m = aggregator.buildMap([{from:rnd, to: rnd+1, contractId: rnd}], i, dt)
    }
    const ms = Date.now() - start
    console.log(`times ${times}, avg ${(ms / times).toPrecision(5)}`)
    measure.dump(`----`)
    process.exit(0);
}
async function testTop() {
    const [,,cmd,d] = process.argv
    if (cmd !== 'test-top') {
        return
    }
    const {maxTimeStart, list:{sender,receiver,all}, timeBegin} = await topUnique({limit: 10, day: parseInt(d||'7')})
    // @ts-ignore
    const table = (topList)=>topList.map((r,idx)=>`${idx} ${r.contractId} s ${r.sender} r ${r.receiver} a ${r.all}`).join('\n')
    console.log(`timeBegin ${timeBegin.toISOString()} - maxTimeStart ${maxTimeStart.toISOString()}`)
    console.log(`${table(sender)}\n`)
    console.log(`${table(receiver)}\n`)
    console.log(`${table(all)}`)
    process.exit(0)
}
async function testDaily() {
    const [,,cmd,d] = process.argv
    if (cmd !== 'test-daily') {
        return
    }
    await calcOneDayUniqueArr( d ? new Date(d) : new Date())
    process.exit(0)
}
// 3000 epoch is about an hour.
// noinspection DuplicatedCode
async function setup(cfxUrl:string, fromEpoch = '30495305', taskLen = '3000') {
    const config = await init();
    await RedisWrap.connect(config.redis)
    console.log(`--------------------`)
    await testTop();
    await testDaily();
    await benchmark();
    await clean();
    const cfxOp = cfxUrl === 'useConfigRpc' ? config.conflux : {url: cfxUrl}
    let cfx = new Conflux(cfxOp)
    patchHttpProvider(cfx, cfxOp)
    const st = await cfx.getStatus()
    console.log(` ${process.argv[1]} \n -------- network ${st.networkId} --------`)
    return runTask(cfx, parseInt(fromEpoch), parseInt(taskLen))
}
// noinspection DuplicatedCode
async function runTask(cfx:Conflux, fromEpoch:number = 0, len) {
    const task = await fetchTask(len, fromEpoch)
    console.log(` start task, [${task.epoch}, ${task.range+task.epoch}), len ${task.range}`)
    await new Promise(r=>{
        run(cfx, task.epoch, task.epoch + task.range, ()=>{
            r(0)
        })
    })
    if (len === 0) {
        console.log(`length parameter is zero, quit.`)
        process.exit(0)
    } else {
        setTimeout(() => runTask(cfx, fromEpoch, len), 0)
    }
}
if (module === require.main) {
    redirectLog()
    regExitHook()
    const [, , cfxUrl, fromEpoch, taskLen] = process.argv
    setup(cfxUrl, fromEpoch, taskLen).then().catch(err => {
        console.log(`${process.argv[1]}\n`, err)
        process.exit(1)
    })
}