/**
 * Unique address for each token.
 */

import {adjustTodayEndTime} from "../model/Utils";
import {redirectLog} from "../config/LoggerConfig";
import {DailyTokenTxn, Erc20Transfer, TOKEN_TYPE_ALL_4} from "../model/Erc20Transfer";
import {regExitHook, sleep} from "./tool/ProcessTool";
import {col, DataTypes, literal, Model, Op, QueryTypes, Sequelize} from 'sequelize'
import {DailyToken, IDailyToken} from "../model/Token";
import {Conflux, format} from "js-conflux-sdk";
import {init} from "./tool/FixDailyTokenStat";
import {initCfxSdk} from "./common/utils";
import {PreLoader} from "./common/PreLoader";
import {Log as CfxLog} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {TokenTool} from "./tool/TokenTool";
import {makeIdV} from "../model/HexMap";
import {Measure} from "./common/Measure";
import {Epoch} from "../model/Epoch";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {EpochHashTokenTransfer} from "../TokenTransferSync";

process.env.TZ='UTC'

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
            console.log(`UniqueAddr resume exists task ${fromEpoch}`)
            return exactOne;
        }
        if (fromEpoch == -1) {
            if (runningOne) {
                console.log(`UniqueAddr resume running task ${runningOne.epoch}`)
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
            console.log(`UniqueAddr create task, epoch ${preEnd}`)
            ok = true
        }).catch(err=>{
            console.log(`UniqueAddr create task fail, ${err}, try again`)
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

const MINUTES_SPAN = 10
export async function calcDailyUniqueAddrSchedule() {
    setTimeout(()=>calcDailyUniqueAddr(), 10_000); // delay when startup.
    setTimeout(()=>calcDailyUniqueAddrSchedule(), MINUTES_SPAN*60_000)//
}
export async function calcDailyUniqueAddr() {
    const dt = new Date();
    const hour = dt.getHours();
    if (hour === 1 && dt.getMinutes() < MINUTES_SPAN * 2) {
        //
        const preDay = new Date(dt);
        preDay.setDate(preDay.getDate() - 1)
        await calcOneDayUniqueArr(preDay)
    }
    await calcOneDayUniqueArr(dt)
}
export async function calcDailyTokenOnChain(dt: Date) {
    // console.log(`calcDailyTokenOnChain ${dt.toISOString()}`)
    const timeBegin = new Date(dt); timeBegin.setHours(0,0,0,0)
    const timeEnd = new Date(timeBegin); timeEnd.setHours(23,59,59,999);
    adjustTodayEndTime(timeEnd)
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
        userCount, type: TOKEN_TYPE_ALL_4,
        createdAt: timeEnd,
    })
}
export async function calcOneDayUniqueArr(dt:Date) {
    const timeBegin = new Date(dt); timeBegin.setHours(0,0,0,0)
    const timeEnd = new Date(timeBegin); timeEnd.setHours(23,59,59,999);
    adjustTodayEndTime(timeEnd)
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
            createdAt: timeEnd,
        }
        await DailyToken.bulkCreate([bean], {
            updateOnDuplicate: ['uniqueSender','uniqueReceiver', 'participants'],
        })
    }
    console.log(`UniqueAddr calculate daily token unique addr done. count ${list.length}, day ${timeBegin.toISOString()}`);
    await calcDailyTokenOnChain(dt);
}
export async function topUnique({limit = 10, day = 7, showSql = false}) {
    // index on timeStart, not timeEnd.
    const maxUnique = await UniqueAddress.findOne({order:[['timeStart','desc']]})
    if (maxUnique === null) {
        if (!this.___show_log){
            console.log(`UniqueAddr no unique address record found.`)
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

const measure = new Measure()
const addrMap = new Map<string, string>()
const addrIdMap = new Map<string, number>()
const ADDR_LEN = 8 // 40. only save the tail of an address.
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
        console.log(`UniqueAddr save unique address, contract count ${aggregator.allMap.size
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
let maxDbTransferEpoch = 0;
async function run(cfx:Conflux, fromEpoch:number, stopBeforeEpoch:number, endFn:()=>void) {
    const sql = [Erc20Transfer, Erc721Transfer, Erc1155Transfer].map(t=>{
        return ` select contractId, fromId as \`from\`, toId as \`to\` from ${t.getTableName()} where epoch=? `
    }).join(" union ");
    console.log(` sql is `, sql)
    const aggregator = new Aggregator<number,string>();
    async function getLogs(epochNumber: number) : Promise<any>{
        const [block, logs] = await measure.call('rpc', ()=> Promise.all([
            Epoch.findOne({where: {epoch: epochNumber}}),
            Epoch.sequelize.query(sql, {type: QueryTypes.SELECT, raw: true, replacements: [epochNumber, epochNumber, epochNumber]})
        ]))
        if (!block) {
            return Promise.reject("epoch not ready")
        }
        const dt = block.timestamp;
        // return {arr:[{createdAt:dt}]};
        return measure.call('polishLogs',()=>Promise.resolve(logs)).then(logs=>{
            return measure.execute('buildMap', ()=>aggregator.buildMap(logs as any, epochNumber, dt))
        }).then(()=>{
            return {arr:logs, epochTime: dt};
        })
    }
    let timeStart, timeEnd;
    const loader = new PreLoader(cfx, getLogs, 10000, stopBeforeEpoch);
    loader.preLoadSize = 5
    let epoch = fromEpoch;//await cfx.getEpochNumber().then(res=> res - 1000)
    let delay = 0
    async function biz() {
        while (epoch >= maxDbTransferEpoch) {
            await sleep(2_000)
            maxDbTransferEpoch = await EpochHashTokenTransfer.findOne({order: [['epoch', 'desc']]}).then(res => res?.epoch - 100)
        }
        const {action, data} = await loader.get(epoch);
        delay = 0;
        const epochMeasureKey = 'perEpoch';
        switch (action) {
            case "ok":
                if (data instanceof Error || !data?.arr) {
                    console.log(`UniqueAddr error data, epoch ${epoch}. `, data)
                    delay = 10_000 // retry.
                    break;
                }
                let transfers: any;
                try {
                    transfers = data;
                } catch (e) {
                    console.log(`UniqueAddr error when load data, epoch ${epoch}. `, e)
                    delay = 10_000 // retry.
                    break;
                }
                const log = epoch % 100 === 0
                const {arr: [sample], epochTime} = transfers
                if (timeStart) {
                    timeEnd = epochTime
                } else {
                    timeStart = epochTime;
                }
                if (!log) {
                    // skip
                } else if (sample) {
                    const epochHour = transfers.epochTime.getHours();
                    console.log(`UniqueAddr sample transfer at epoch ${epoch} hour ${epochHour
                    }, contract ${sample.contractId
                    } : ${sample.from} -> ${sample.to
                    }, preload size ${loader.data.size}, epoch time ${transfers.epochTime.toISOString()
                    } transfer count ${transfers.arr.length}`)
                } else {
                    console.log(`UniqueAddr no transfer at ${epoch}`)
                }
                if (epoch % 100 === 0) {
                    measure.dump(`\n UniqueAddr --`, undefined, epochMeasureKey, 'rpc', 'polishLogs', 'buildMap', 'idLength');
                    loader.dumpMetrics(` --------------- get logs metrics , addr count ${addrIdMap.size}`)
                }
                epoch++
                break;
            case "pop":
                console.log(`UniqueAddr pop ${epoch}`);
                epoch--
                break;
            case "wait":
                console.log(`UniqueAddr wait for ${epoch}`)
                delay = 5000
                break;
        }
    }
    async function repeat() {
        try {
            await biz();
            if (epoch < stopBeforeEpoch) {
                setTimeout(repeat, delay)
            } else {
                console.log(`UniqueAddr round end, [${fromEpoch}, ${stopBeforeEpoch})`)
                await saveUniqueAddrToDb(aggregator, {
                    epoch: fromEpoch
                })
                endFn()
            }
        } catch (e) {
            console.log(`${__filename} failed to repeat:`, e)
            setTimeout(repeat, 5_000)
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
    const dt = new Date()
    const start = Date.now()
    const aggregator = new Aggregator();
    for (let i = 0; i < times; i++) {
        const rnd = Math.round(Math.random() * 1000)
        const m = aggregator.buildMap([{from:rnd, to: rnd+1, contractId: rnd}], i, dt)
    }
    const ms = Date.now() - start
    console.log(`UniqueAddr times ${times}, avg ${(ms / times).toPrecision(5)}`)
    measure.dump(`UniqueAddr ----`)
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
    console.log(`UniqueAddr --------------------`)
    await testTop();
    await testDaily();
    await benchmark();
    const confluxOption = cfxUrl === 'useConfigRpc' ? config.conflux : {url: cfxUrl}

    let cfx = await initCfxSdk(confluxOption);
    // console.log(` ${process.argv[1]} \n -------- network ${cfx.networkId} --------`)

    return runTask(cfx, parseInt(fromEpoch), parseInt(taskLen))
}
// noinspection DuplicatedCode
async function runTask(cfx:Conflux, fromEpoch:number = 0, len) {
    const task = await fetchTask(len, fromEpoch)
    console.log(`UniqueAddr start task, [${task.epoch}, ${task.range+task.epoch}), len ${task.range}`)
    await new Promise(r=>{
        run(cfx, task.epoch, task.epoch + task.range, ()=>{
            r(0)
        })
    })
    if (len === 0) {
        console.log(`UniqueAddr length parameter is zero, quit.`)
        process.exit(0)
    } else {
        setTimeout(() => runTask(cfx, fromEpoch, len), 0)
    }
}

export async function startUniqueAddrStat() {
    return setup("useConfigRpc", "-1", "300")
}

if (module === require.main) {
    redirectLog()
    regExitHook()
    const [, , cfxUrl, fromEpoch, taskLen] = process.argv
    setup(cfxUrl, fromEpoch, taskLen).then().catch(err => {
        console.log(`UniqueAddr ${process.argv[1]}\n`, err)
        process.exit(1)
    })
}
