/**
 * Unique address for each token.
 */

import {adjustTodayEndTime, patchDateOnlyField} from "../model/Utils";
import {redirectLog} from "../config/LoggerConfig";
import {DailyTokenTxn, Erc20Transfer, TOKEN_TYPE_ALL_4} from "../model/Erc20Transfer";
import {regExitHook, sleep} from "./tool/ProcessTool";
import {col, DataTypes, literal, Model, Op, QueryTypes, Sequelize} from 'sequelize'
import {DailyToken, IDailyToken} from "../model/Token";
import {Conflux} from "js-conflux-sdk";
import {fixParticipants, init} from "./tool/FixDailyTokenStat";
import {initCfxSdk} from "./common/utils";
import {TokenTool} from "./tool/TokenTool";
import {Measure} from "./common/Measure";
import {Epoch} from "../model/Epoch";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {EpochHashTokenTransfer} from "../TokenTransferSync";
import {ConfigInstance, FirstBlockNo} from "../config/StatConfig";
import {PreloadMap} from "./SyncBase";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {ADDR_LEN, UniqueAddressDaily, UniqueAddressHourly} from "../model/UniqueAddr";

process.env.TZ='UTC'

//
export interface IUniqueAddress {
    id?:number
    epochStart:number
    epochEnd: number
    timeStart: Date
    timeEnd: Date
    contractId:number
    addr:number;
    fromMark: boolean
    toMark: boolean
}
export class UniqueAddress extends Model<IUniqueAddress> implements IUniqueAddress {
    id?:number
    // main prop
    contractId:number
    addr:number;
    fromMark: boolean
    toMark: boolean
    epochStart:number // it's the start epoch of the task.

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
            addr: {type: DataTypes.BIGINT, allowNull: false, },
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
// from epoch is from startup argument, so it's safe using it when resuming the task.
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
                fromEpoch = FirstBlockNo
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

// assume that all records are within one epoch, so they have the same time.
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


export async function buildUniqueAddrHourly() {
    // find max unique addr bean
    const maxUniqueAddr = await UniqueAddress.findOne({
        order: [['timeStart', 'desc']], limit: 1, raw: true,
    })
    if (!maxUniqueAddr) {
        console.log(`${__filename} no unique addr found`);
        return;
    }
    let startTime: Date;
    const maxUAHourly = await UniqueAddressHourly.findOne({
        order: [['id', 'desc']], limit: 1, raw: true,
    })
    if (maxUAHourly) {
        startTime = maxUAHourly.timeStart;
        startTime.setHours(startTime.getHours() + 1); // next hour of the previous record.
    } else {
        const now = new Date();
        now.setHours(now.getHours() - (24 * 7 + 1)); // 7 days 1 hour ago
        startTime = now;
        startTime.setMinutes(0, 0, 0);
    }
    const endTimeHour = new Date(startTime);
    endTimeHour.setMinutes(59, 59, 999);
    const table = UniqueAddress.getTableName();
    const hourlyTable = UniqueAddressHourly.getTableName();
    while (maxUniqueAddr.timeEnd >= endTimeHour) {
        const sql = `
        insert into ${hourlyTable} (timeStart, timeEnd, contractId, addr, fromMark, toMark, createdAt, updatedAt)
            (select ?, ?,  contractId, addr, sum(fromMark), sum(toMark), now(), now() from ${
                table} where timeStart between ? and ? group by contractId, addr
            ) on duplicate key update updatedAt = values(updatedAt)`;
        const result = await UniqueAddressHourly.sequelize.query(sql, {
            replacements: [startTime, endTimeHour, startTime, endTimeHour],
            logging: (sql , ms) => {
                // console.log(`${__filename} hourly unique addr in one sql (${ms}ms):\n`, sql);
            },
            benchmark: true,
        })
        console.log(`unique addr hourly, ${startTime.toISOString()} result `, result);
        //increase the time window
        startTime.setHours(startTime.getHours() + 1);
        endTimeHour.setHours(endTimeHour.getHours() + 1);
    }
    console.log(`unique address time not reach , ${maxUniqueAddr.timeEnd.toISOString()} < ${endTimeHour.toISOString()}`);
}

export async function buildUniqueAddrDaily() {
    // find max unique addr bean
    const maxUniqueAddrHourly = await UniqueAddressHourly.findOne({
        order: [['timeStart', 'desc']], limit: 1, raw: true,
    })
    if (!maxUniqueAddrHourly) {
        console.log(`${__filename} no unique addr found`);
        return;
    }
    let startTime: Date;
    const maxUADaily = await UniqueAddressDaily.findOne({
        order: [['timeStart', 'desc']], limit: 1, raw: true,
    })
    if (maxUADaily) {
        startTime = maxUADaily.timeStart;
        startTime.setDate(startTime.getDate() + 1); // next data of the previous record.
    } else {
        const now = new Date();
        now.setDate(now.getDate() - 8); // 8 days ago
        startTime = now;
        startTime.setHours(0, 0, 0, 0);
    }
    const endTimeDay = new Date(startTime);
    endTimeDay.setHours(23,59, 59, 999);
    const table = UniqueAddressHourly.getTableName();
    const dailyTable = UniqueAddressDaily.getTableName();
    while (maxUniqueAddrHourly.timeEnd >= endTimeDay) {
        const sql = `
        insert into ${dailyTable} (timeStart, timeEnd, contractId, addr, fromMark, toMark, createdAt, updatedAt)
            (select ?, ?,  contractId, addr, sum(fromMark), sum(toMark), now(), now() from ${
            table} where timeStart between ? and ? group by contractId, addr
            ) on duplicate key update updatedAt = values(updatedAt)`;
        const result = await UniqueAddressHourly.sequelize.query(sql, {
            replacements: [startTime, endTimeDay, startTime, endTimeDay],
            logging: (sql , ms) => {
                // console.log(`${__filename} hourly unique addr in one sql (${ms}ms):\n`, sql);
            },
            benchmark: true,
        })
        console.log(`unique addr daily, ${startTime.toISOString()} result `, result);
        //increase the time window
        startTime.setDate(startTime.getDate() + 1);
        endTimeDay.setDate(endTimeDay.getDate() + 1);
    }
    console.log(`daily, unique address time not reach , ${maxUniqueAddrHourly.timeEnd.toISOString()} < ${endTimeDay.toISOString()}`);
}

async function calcDailyUniqueAddr() {
    const latestOne = await UniqueAddress.findOne({order: [['timeStart', 'desc']], raw: true});
    await fixParticipants(latestOne?.timeStart).catch(e=>{
        safeAddErrorLog('stat-task', 'calc-daily-unique-addr', e).then();
        console.log(`${__filename} calc daily unique addr:`, e)
    });
}

export async function calcDailyTokenTxn(timeBegin: Date, timeEnd: Date) {
    adjustTodayEndTime(timeEnd)
    const transferCount = await DailyToken.sum('transferCount',{
        where: {day: timeBegin}, raw: true,
        // logging: sqlLogFn(`${__filename} calc daily token`),
    }).then(res=>{
        return res ?? 0;
    })
    const userCount = await UniqueAddress.count({
            distinct: true, col: 'addr',
            where: {timeStart: {[Op.between]: [timeBegin, timeEnd]}},
            // logging: sqlLogFn(`${__filename} unique user count`),
        },
    )
    await DailyTokenTxn.upsert({
        day: timeBegin, txnCount: transferCount,
        userCount, type: TOKEN_TYPE_ALL_4,
        createdAt: timeEnd,
    })
}
export async function calcOneDayUniqueAddrAndTokenTxn(dt:Date) {
    const timeBegin = new Date(dt);
    timeBegin.setHours(0, 0, 0, 0)
    const timeEnd = new Date(timeBegin);
    timeEnd.setHours(23, 59, 59, 999);
    adjustTodayEndTime(timeEnd)
    await calcOneDayUniqueAddr(timeBegin, timeEnd);
    await calcDailyTokenTxn(timeBegin, timeEnd);
}
async function calcOneDayUniqueAddr(timeBegin: Date, timeEnd: Date) {
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
}
export async function topUnique({limit = 10, day = 7, showSql = false}) {
    // index is on timeStart, not timeEnd.
    // do not use universal time because the result may be too few.
    const maxUnique = ConfigInstance.noTopToken ? null
        : await (day > 1 ? UniqueAddressDaily : UniqueAddressHourly).findOne({order:[['timeStart','desc']]});
    if (maxUnique === null) {
        if (!this.___show_log){
            console.log(`UniqueAddr no unique address record found.`)
            this.___show_log = true;
        }
        return {list: {sender:[],receiver:[],all:[]}, timeBegin: new Date(0), maxTimeStart: new Date(0), alignTimeEnd: undefined}
    }
    let timeBegin: Date;
    let alignTimeEnd = new Date(maxUnique.timeStart);
    if (day > 1) {
        alignTimeEnd.setHours(0, 0, 0, 0);
        timeBegin = new Date(alignTimeEnd);
        timeBegin.setDate(timeBegin.getDate() - day + 1);
    } else {
        alignTimeEnd.setMinutes(0, 0, 0);
        timeBegin = new Date(alignTimeEnd);
        timeBegin.setHours(timeBegin.getHours() - 23);
    }
    const ms = Date.now();
    return (day > 1 ? UniqueAddressDaily : UniqueAddressHourly).findAll(({
        attributes: [
            'contractId',
            [literal('count(distinct(if(fromMark, addr, "")))'), 'sender'],
            [literal('count(distinct(if(toMark, addr, "")))'), 'receiver'],
            [literal('count(distinct(addr))'), 'all'],
        ], raw: true, group: ['contractId'], order: [[col('all'), 'desc']],
        where: {timeStart:{[Op.between]: [timeBegin, alignTimeEnd]}}, limit: limit * 6,
        logging: showSql ? console.log : false,
    })).then(list=>{
        const duration = Date.now() - ms;
        return {list: classifyTopList(list), timeBegin, maxTimeStart: maxUnique.timeStart, alignTimeEnd, duration};
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
    // console.log(` sql is `, sql)
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
    const loader = new PreloadMap(getLogs, 1);
    let epoch = fromEpoch;//await cfx.getEpochNumber().then(res=> res - 1000)
    let delay = 0
    async function biz() {
        while (epoch >= maxDbTransferEpoch) {
            await sleep(2_000)
            maxDbTransferEpoch = await EpochHashTokenTransfer.findOne({order: [['epoch', 'desc']]}).then(res => res?.epoch - 100)
        }
        let action = 'ok'
        const data = await loader.pop(epoch);
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
                    }, preload size ${loader.size}, epoch time ${transfers.epochTime.toISOString()
                    } transfer count ${transfers.arr.length}`)
                } else {
                    console.log(`UniqueAddr no transfer at ${epoch}`)
                }
                if (epoch % 100 === 0) {
                    measure.dump(`\n UniqueAddr --`, undefined, epochMeasureKey, 'rpc', 'polishLogs', 'buildMap', 'idLength');
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
            safeAddErrorLog('token-x', 'unique-addr', e).then();
            console.log(`${__filename} failed to repeat:`, e)
            setTimeout(repeat, 5_000)
        }
    }
    repeat().then()
}

// 3000 epoch is about an hour.
// noinspection DuplicatedCode
async function setup(cfxUrl:string, fromEpoch = '30495305', taskLen = '3000') {
    const config = await init();
    console.log(`UniqueAddr --------------------`)
    const confluxOption = cfxUrl === 'useConfigRpc' ? config.conflux : {url: cfxUrl}

    let cfx = await initCfxSdk(confluxOption);
    // console.log(` ${process.argv[1]} \n -------- network ${cfx.networkId} --------`)

    return runTask(cfx, parseInt(fromEpoch), parseInt(taskLen))
}
// noinspection DuplicatedCode
async function runTask(cfx:Conflux, fromEpoch:number = 0, len: number) {
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

export async function startUniqueAddrStat(cfx: Conflux) {
    return runTask(cfx, -1, 300);
}

async function main() {
    const [,,cmd, arg1] = process.argv;
    if (cmd === 'test-unique-hourly') {
        await init();
        await buildUniqueAddrHourly()
        await UniqueAddressHourly.sequelize.close();
    } else if (cmd === 'test-unique-daily') {
        await init();
        await buildUniqueAddrDaily();
        await UniqueAddressHourly.sequelize.close();
    } else if (cmd === 'top-unique') {
        await init();
        const rank = await topUnique({limit: 10, day: parseInt(arg1 || '7')});
        console.log(`rank is`, rank);
        await UniqueAddressHourly.sequelize.close();
    } else {
        console.log(`nothing [${cmd}]`);
    }
    //
    // redirectLog()
    // regExitHook()
    // const [, , cfxUrl, fromEpoch, taskLen] = process.argv
    // setup(cfxUrl, fromEpoch, taskLen).then().catch(err => {
    //     console.log(`UniqueAddr ${process.argv[1]}\n`, err)
    //     process.exit(1)
    // })
}

if (module === require.main) {
    main().then()
}
// node stat/service/UniqueAddressStat.js test-unique-hourly
// node stat/service/UniqueAddressStat.js test-unique-daily
// node stat/service/UniqueAddressStat.js top-unique 7
// node stat/service/tool/FixDailyTokenStat.js dailyTokenTxn 2020-10-29
