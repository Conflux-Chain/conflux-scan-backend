import {redirectLog} from "./config/LoggerConfig";
import {Transaction, Model,DataTypes, Sequelize, Op, UniqueConstraintError, ModelStatic} from "sequelize";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {batchTraceBlock, initCfxSdk, isNewFormatTrace, removeLongData} from "./service/common/utils";
import {Measure} from "./service/common/Measure";
import {IEpochTask} from "./service/UniqueAddressStat";
import {fetchTask} from "./TokenTransferSync";
import {FullBlock, FullTransaction, loadMaxBlockEpoch} from "./model/FullBlock";
import {idHex40Map, makeIdV, makeVirtualContractInfo, patchPocketAddress, POCKET_ADDRESS_MAP} from "./model/HexMap";
import {
    AddressCfxTransfer, CFX_TRANSFER_PAGE_MARK_SIZE,
    CfxTransfer, checkCfxTransferCountKV,
    doMark,
    ICfxTransfer,
    markCfxTransferPosition,
    popPartitionCfxTransfer, scheduleRollupDailyCfxTxn
} from "./model/CfxTransfer";
import {regExitHook, sleep} from "./service/tool/ProcessTool";
import {finishTask, IEpochTokenTransfer, waitParentHashDB} from "./TokenTransferSync";
import {PreLoader} from "./service/common/PreLoader";
import {KEY_FULL_CFX_TRANSFER_COUNT, KV} from "./model/KV";
import {CfxWatcher} from "./service/watcher/BalanceWatcher";
import {scheduleCrossSpaceStat} from "./service/CrossSpaceStat";
import {Stopwatch} from "./service/Stopwatch";

export interface IEpochCfxTransferCount {
    id?:number; epoch:number; n:number;
}
// trace count, multiple task will conflict if they update counter and paging mark.
export class EpochCfxTransferCount extends Model<IEpochCfxTransferCount> implements IEpochCfxTransferCount {
    id?:number; epoch:number; n:number;
    static register(seq:Sequelize) {
        EpochCfxTransferCount.init({
            id: {type:DataTypes.BIGINT({unsigned: true}), primaryKey: true, autoIncrement: true},
            epoch: {type:DataTypes.BIGINT({unsigned: true}), allowNull: false},
            // when pop, it's negative.
            n: {type:DataTypes.BIGINT(), allowNull: false},
        },{
            sequelize: seq, tableName: 'epoch_cfx_transfer_count', timestamps: false,
        })
    }
}
export interface ICfxUser {
    id?: number
    fromId: number
    toId: number
}
// used to update total supply and holder. records is deleted after processing.
export class CfxUser extends Model<ICfxUser> implements ICfxUser {
    id:number
    fromId: number
    toId: number
    static register(seq:Sequelize) {
        CfxUser.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
        }, {
            sequelize: seq, tableName: 'cfx_user',
            timestamps: false,
        })
    }
}
export interface IEpochHashCfxTransfer {
    epoch:number
    hash:string
}

// used to find parent hash when popping
export class EpochHashCfxTransfer extends Model<IEpochHashCfxTransfer>
    implements IEpochHashCfxTransfer{
    epoch:number
    hash:string
    static register(seq: Sequelize) {
        EpochHashCfxTransfer.init({
            epoch : {type: DataTypes.BIGINT({unsigned: true}), primaryKey: true},
            hash: {type: DataTypes.CHAR(66), allowNull: false},
        },{
            sequelize: seq, tableName: 'epoch_hash_cfx_transfer',
            updatedAt: false,
        })
    }
}
export interface ITaskCfxTransfer extends IEpochTask {
    cursor:number
    checkPivot?: boolean
}
// task table.
export class TaskCfxTransfer extends Model<ITaskCfxTransfer> implements ITaskCfxTransfer{
    epoch: number
    range: number
    createdAt: Date
    updatedAt: Date
    finished: boolean

    cursor: number;
    static register(seq: Sequelize) {
        TaskCfxTransfer.init({
            epoch: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true},
            cursor: {type: DataTypes.BIGINT, allowNull: false},
            range: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
            finished: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
        },{
            sequelize: seq, tableName: 'task_cfx_transfer',
        })
    }
}
let cfx0:Conflux
export function setCfxSync(cfx: Conflux) {
    cfx0 = cfx
}
export async function getCfxTransferTraces(epoch: number, checkPivot:boolean)
    : Promise<{result?:ICfxTransfer[], code?: number, addrBeans?:any[], pivotHash?:string, parentHash?:string}>{
    const cfx = cfx0;
    // speed up in case no transaction in epoch.
    const [txMapByHash, blockArrDb, pivotBlock] = await Promise.all([FullTransaction.findAll({
            where: {epoch}, order: [['blockPosition', 'asc'],['txPosition', 'asc']]
        }).then(list=>{
            const txMap = new Map<string, FullTransaction>()
            list.forEach(tx=>{
                txMap.set(tx.hash, tx)
            })
            return txMap
        }),
        FullBlock.findAll({where: {epoch}, order:[['position','asc']], raw: true}),
        cfx.getBlockByEpochNumber(epoch),
    ])
    if (blockArrDb.length == 0) {
        console.log(`no block in db, epoch ${epoch} }`)
        return {code: 404}
    }
    if (txMapByHash.size === 0 && !checkPivot) {
        // catchup mode, shortcut when tx in db was empty.
        return {result: [], addrBeans: [], code: 0, pivotHash: '-', parentHash: '-'};
    }
    const hashes = blockArrDb.map(blk=>blk.hash);
    if (pivotBlock.hash != hashes[hashes.length - 1]) {
        console.log(`rpc pivotBlock.hash ${pivotBlock.hash}`)
        console.log(`db  pivot has ${hashes[hashes.length - 1]} mismatch , epoch ${epoch}`)
        return {code: 404}
    }

    const result:ICfxTransfer[] = [];
    const addrBeans = []
    const traceArray2d:any[] = await batchTraceBlock(cfx, hashes);
    const isNewTraceFormat = true;//isNewFormatTrace(traceArray2d)
    for (let blkIdx = 0; blkIdx < traceArray2d.length; blkIdx++) {
        let traceOfBlock = traceArray2d[blkIdx];
        if (traceOfBlock === null) {
            continue
        }
        const {blockHash, transactionTraces, epochHash, epochNumber} = traceOfBlock;
        if (epochNumber != epochNumber) {
            console.log(`epoch number in trace ${epochNumber}`)
            console.log(`mismatch! want epoch ${epoch}`)
            return {code : 404} // try again
        }
        if (epochHash != pivotBlock.hash) {
            console.log(`epoch hash in trace ${epochHash}`)
            console.log(`pivot block hash ${pivotBlock.hash} , mismatch! epoch ${epoch}`)
            return {code : 404} // try again
        }
        if (blockHash !== blockArrDb[blkIdx].hash) {
            console.log(`block hash in trace ${blockHash}`)
            console.log(`block hash in DB    ${blockArrDb[blkIdx].hash} , mismatch! epoch ${epoch}`)
            return {code : 404} // try again
        }
        const txArr = (transactionTraces || []) as any[];
        for (let txIdx = 0; txIdx < txArr.length; txIdx++) {
            // there are skipped txs. its trace is empty.
            const {traces, transactionHash, transactionPosition} = txArr[txIdx];
            if (traces.length === 0) {
                // failed tx (lack of gas) may have zero trace, too.
                continue
            }
            // track by position is hard(impossible).
            // tracy by tx hash and check block position.
            const txKey = transactionHash;
            const txBean = txMapByHash.get(txKey)
            txMapByHash.delete(txKey)
            if (!txBean) {
                console.log(`rpc trace at epoch ${epoch} block ${blkIdx} full-tx-idx ${txIdx
                }, without tx in db. want tx hash ${transactionHash}`)
                // find from rpc.
                const txByRpc = await cfx.getTransactionReceipt(transactionHash)
                if (txByRpc) {
                    console.log(` tx by rpc exists. wait .`)
                    return {code: 404}
                } else {
                    console.log(` tx by rpc absent. SKIP .`)
                    continue;
                }
            } else if (txBean.status !== 0) {
                continue
            }
            if (txBean.blockPosition !== blkIdx) {
                console.log(`rpc block pos ${blkIdx} != ${txBean.blockPosition} in db. \n epoch ${epoch
                }, full-tx-idx ${txIdx}`);
                return {code : 404} // try again
            }
            const traceArr = traces as any[];
            for (let traceIdx = 0; traceIdx < traceArr.length; traceIdx++) {
                let {action: {outcome, from, to, value, callType, fromPocket, toPocket, fromSpace, toSpace, space}, type, valid} = traceArr[traceIdx]
                if (!valid) {
                    continue
                }
                from = patchPocketAddress(fromPocket, from);
                to = patchPocketAddress(toPocket, to)
                // doc https://github.com/Conflux-Chain/CIPs/issues/88
                if (!value
                    || callType === 'none'
                    || callType === 'callcode'
                    || callType === 'delegatecall'
                    || callType === 'staticcall'
                    // both side pocket is set , not equal to 'balance', it's sponsor mechanism.
                    || (fromPocket && fromPocket !== 'balance' && toPocket && toPocket !== 'balance')
                    ||
                    (
                        isNewTraceFormat &&
                        (
                            // scan doesn't save gas/storage payment as cfx transfer records.
                            fromPocket === 'gas_payment' || toPocket === 'gas_payment' // save it except gas
                        )
                    )
                ) {
                    continue
                }
                if (callType !=='call' && type === 'call') {
                    console.log(`unknown call type ${callType} type ${type}, epoch ${epoch} block ${blockHash
                    } tx ${txBean.txPosition}, full-tx-idx ${txIdx} tp ${transactionPosition} ${transactionHash},  trace ${traceIdx}`)
                    process.exit(8)
                }
                if (type === 'internal_transfer_action') {
                    if (POCKET_ADDRESS_MAP[fromPocket]) {
                        type = fromPocket
                    } else if (POCKET_ADDRESS_MAP[toPocket]) {
                        type = toPocket
                    }
                } else if (type === 'create' || type ==='call') {
                } else if (type === 'create_result' || type ==='call_result') {
                    //value should be zero, won't trigger
                } else {
                    console.log(`unknown trace type ${type}, epoch ${epoch} block ${blockHash
                    } tx ${txBean.txPosition}, trace ${traceIdx}, tx hash ${transactionHash}`)
                    process.exit(8)
                    return
                }
                const fromId = await makeIdV(from)
                const toId = await makeIdV(to)
                const bean:ICfxTransfer = {
                    epoch, blockIndex: blkIdx, txIndex: txBean.txPosition, txLogIndex: traceIdx,
                    fromId, toId, createdAt:txBean.createdAt, value, type,
                }
                bean['addressId'] = fromId
                result.push(bean)
                addrBeans.push(bean)
                if (fromId !== toId) {
                    addrBeans.push({...bean, addressId: toId})
                }
            }
        }
    }
    const remainOkTxCount = [...txMapByHash.values()].filter(tx=>tx.status === 0).length
    if (remainOkTxCount !== 0 && epoch > 0) {
        // all tx should be matched and removed in map.
        console.log(`db has more tx, remain ${txMapByHash.size}, epoch ${epoch}, trace count ${result.length}.`)
        console.log(` ${[...txMapByHash.values()].map(tx=>`block ${tx.blockPosition} txPos ${tx.txPosition}, ${tx.hash}`).join('\n')}`)
        // process.exit(9)
        return {code : 404}
    }
    // removeLongData(traceArray2d);
    // console.log(JSON.stringify(traceArray2d, null, 4))
    return {result, addrBeans, code: 0, pivotHash: pivotBlock.hash, parentHash: pivotBlock.parentHash}
}
async function runCounter() {
    await counter().catch(e=>{
        console.log(`${__filename} failed to run counter`, e)
        return sleep(10_000)
    });
    setTimeout(runCounter, 1)
}
async function setup() {
    const [, , cfxUrlParam, fromEpoch, taskLen] = process.argv
    const config = await init()
    await checkCfxTransferCountKV()
    const cfxUrl = cfxUrlParam === 'useConfigRpc' ? (config.cfxTransferRpc?.url || config.conflux.url) : cfxUrlParam
    if (cfxUrl === 'counter') {
        redirectLog({subPath:'.counter'})
        await runCounter()
        return
    } else if (fromEpoch === 'holder') {
        redirectLog({subPath:'.holder'})
        const cfx = await initCfxSdk({url: cfxUrl});
        await runHolder(cfx);
        return;
    } else if (cfxUrl === 'marker') {
        redirectLog({subPath:'.marker'})
        await runMarker();
        return;
    }
    redirectLog()
    const cfx = await initCfxSdk({url: cfxUrl});
    runCounter().then();
    runHolder(cfx).then();
    runMarker().then();
    cfx0 = cfx;
    await makeVirtualContractInfo(cfx.networkId);
    scheduleRollupDailyCfxTxn().then();
    console.log(`---------- ${cfxUrl} ${cfx.networkId} ---------`)
    if (process.argv.includes('test')) {
        await test(parseInt(fromEpoch))
        process.exit(0)
    } else {
        scheduleCrossSpaceStat(cfx).then()
        return runTask(cfx, parseInt(fromEpoch), parseInt(taskLen))
    }
}
async function test(ep:number) {
    const {addrBeans, result, code} = await getCfxTransferTraces(ep, false)
    if (code === 404) {
        console.log(` tx not sync yet.`)
        await sleep(5_000)
    } else {
        console.log(result.map(t => `ep ${t.epoch} b ${t.blockIndex} t ${t.txIndex
        } l ${t.txLogIndex} ${t.fromId}->${t.toId} v ${t.value} t ${t.type}`));
        console.log(addrBeans.map(t => `ad ${t["addressId"]} ep ${t.epoch} b ${t.blockIndex} t ${t.txIndex
        } l ${t.txLogIndex} v ${t.value} t ${t.type}`));
    }
}
async function save({result, addrBeans, pivotHash}, epoch, taskBegin:number) {
    // console.log(` ph ${pivotHash}`)
    return TaskCfxTransfer.sequelize.transaction(async dbTx=>{
        return Promise.all([
            // KV.diffCount(KEY_FULL_CFX_TRANSFER_COUNT, result.length, dbTx, ),
            new Promise(r=>{
                if (result.length) {
                    // save count, let standalone job to diff count.
                    EpochCfxTransferCount.create({epoch, n:result.length},
                        {transaction: dbTx}).then(r)
                }else {
                    r(void 0)
                }
            }),
            CfxUser.bulkCreate(result, {transaction: dbTx}),
            CfxTransfer.bulkCreate(result, {transaction: dbTx}),
            AddressCfxTransfer.bulkCreate(addrBeans, {transaction: dbTx}),
            EpochHashCfxTransfer.create({epoch, hash: pivotHash},{transaction: dbTx}),
            TaskCfxTransfer.update(
                {cursor: epoch, },
                {where:{epoch:taskBegin}, transaction:dbTx}),
        ])
    })
}
async function pop(epoch: number, taskBegin: number) {
    return TaskCfxTransfer.sequelize.transaction(async dbTx=>{
        return Promise.all([
            EpochHashCfxTransfer.findByPk(epoch-1),
            popPartitionCfxTransfer(epoch, undefined, dbTx),
            EpochHashCfxTransfer.destroy({where: {epoch}, transaction: dbTx}),
            TaskCfxTransfer.update({cursor: epoch - 1},
                {where: {epoch: taskBegin}, limit: 1, transaction:dbTx}
            )
        ])
    })
}
// cfx holder
async function runHolder(cfx:Conflux) {
    if (!cfxWatcher) {
        await cfx.updateNetworkId();
        cfxWatcher = new CfxWatcher('cfx', cfx);
    }
    await holder().catch(err=>{
        console.log(` cfx holder error:`, err)
        return sleep(10_000)
    });
    setTimeout(()=>runHolder(cfx), 0);
}
let cfxWatcher:CfxWatcher;
async function holder() {
    const list = await CfxUser.findAll({order:[['id','asc']], limit: 100})
    if (list.length === 0) {
        console.log(`HOLDER: cfx user table is empty.`)
        await sleep(5_000)
        return;
    }
    const min = list[0].id;
    const max = list[list.length - 1].id;
    const idSet = new Set<number>();
    list.forEach(row=>{
        idSet.add(row.fromId)
        idSet.add(row.toId)
    })
    const idArr = [...idSet];
    const idHexMap = await idHex40Map(idArr)
    let batch = []
    for (const [id,hex] of idHexMap.entries()) {
        batch.push(cfxWatcher.queryBalance('0x'+hex, id))
        if (batch.length == 10) {
            await Promise.all(batch)
            batch = []
        }
    }
    await Promise.all(batch)
    const delCnt = await CfxUser.destroy({where: {id:{[Op.between]:[min, max]}}})
    console.log(` check cfx holder, count ${idArr.length}, min ${min} max ${max}, deleted ${delCnt}`)
}
// marker, handle multiple task situation.
async function runMarker() {
    await marker().catch(e=>{
        console.log(`${__filename} failed to run marker`, e)
        return sleep(10_000)
    });
    setTimeout(runMarker, 0)
}
let preMarkEpoch = 0;
async function marker() {
    // all task under [TOP epoch] must be finished before mark.
    const [minUnderGoingTask, maxFinished ]= await Promise.all([
        TaskCfxTransfer.findOne({
            where: {finished: 0,}, order: [['epoch','asc']]
        }),  //

        TaskCfxTransfer.findOne({
            where: {finished: 1,}, order: [['epoch','desc']]
        }), // in case all task is finished, use this.
    ])
    const top = minUnderGoingTask || maxFinished
    if (!top) {
        console.log(` no task info in db. ${minUnderGoingTask}, ${maxFinished}`)
        await sleep(5_000)
        return;
    }
    if (top.epoch === preMarkEpoch) {
        console.log(`MARKER: no [NEW] task info in db, pre mark ${preMarkEpoch
        }. ${minUnderGoingTask?.epoch}, ${maxFinished?.epoch}`)
        await sleep(5_000)
        return;
    }
    let avoidReOrg = 1000;
    await markCfxTransferPosition(CFX_TRANSFER_PAGE_MARK_SIZE, top.cursor - avoidReOrg);
    preMarkEpoch = top.epoch;
    console.log(`mark done. cursor ${top.cursor} at epoch ${top.epoch}`)
}
// counter , handle multiple task situation.
async function counter() {
    const list = await EpochCfxTransferCount.findAll({
        order: [['id','asc']], limit: 1000
    })
    if (list.length === 0) {
        console.log(`COUNTER: cfx count table is empty.`)
        await sleep(5_000)
        return;
    }
    const {id:minId} = list[0]
    const {id:maxId} = list[list.length-1]

    const sum = list.map(r=>r.n).reduce((a,b)=>a+b)
    await KV.sequelize.transaction(async dbTx=>{
        await KV.diffCount(KEY_FULL_CFX_TRANSFER_COUNT, sum, dbTx)
        const cnt=await EpochCfxTransferCount.destroy({
            where:{id:{[Op.between]:[minId, maxId]}}, transaction: dbTx
        })
    }).then(()=>{
        console.log(`EpochCfxTransferCount ${sum} epoch ${list[0].epoch}`)
    }).catch(err=>{
        console.log(err)
    })
    // can not do mark here. there may be a task with lower epoch and still in progress.
    // await doMark(row, epoch, undefined);
}
async function processEpoch(epoch, data, taskBegin) {
    const {code} = data;
    if (code === 404) {
        return 5_000;
    } else if (code !== 0) {
        return 10_000
    }
    await save(data, epoch, taskBegin)
    return 0;
}
async function run(cfx:Conflux, task:IEpochTokenTransfer, endFn:()=>void) {
    const fromEpoch = task.cursor + 1;
    const stopBeforeEpoch = task.epoch + task.range
    const taskBegin = task.epoch;
    // parentHash, also indicates whether checking parent hash.
    let parentHash = await waitParentHashDB(task, task.cursor, EpochHashCfxTransfer)
    async function wrapFetchData(epoch:number) {
        return getCfxTransferTraces(epoch, task.checkPivot)
    }
    const loader = new PreLoader(cfx, wrapFetchData, 3, stopBeforeEpoch);
    loader.preLoadSize = 10;
    // should not higher than tx sync, otherwise the transaction hash may can not be found.
    let epoch = fromEpoch;
    let maxEpochOfBlock = 0;
    async function updateMaxDbEpoch() {
        const maxE = await loadMaxBlockEpoch()
        if (typeof maxE !== 'number') {
            return;
        }
        maxEpochOfBlock = maxE;
    }
    await updateMaxDbEpoch()
    async function repeat() {
        return repeat0().catch(err=>{
            // DB failure, maybe.
            console.log(` repeat error : `, err)
            setTimeout(repeat, 10_000)
        })
    }
    async function repeat0() {
        if (epoch > maxEpochOfBlock) {
            console.log(` reach max block/tx epoch ${maxEpochOfBlock}`)
            await updateMaxDbEpoch();
            setTimeout(repeat, 5_000)
            return;
        }
        let {action, data} = await measure.call('epoch', () => loader.get(epoch));
        // console.log(`action ${action}, data:`, data)
        let delay = 0
        switch (action) {
            case "ok":
                if (data instanceof Error) {
                    console.log(` error at epoch ${epoch}`, data)
                    delay = 5_000;
                    break;
                }
                // console.log(` epoch ${epoch}, code ${data.code}, parentHash ${parentHash}`, data)
                // previous epoch may have not checked pivot, its pivot hash will be '-'.
                if (data.code === 0 && parentHash && parentHash !== data.parentHash && parentHash !== '-') {
                    console.log(` parent hash not match epoch ${epoch}, want ${parentHash}, actual ${data.pivotHash}`)
                    const [parentH] = await pop(epoch-1, taskBegin)
                    if (parentH === null) {
                        console.log(` after pop, parent hash bean is null, want epoch ${epoch - 2}`)
                        process.exit(9)
                        return;
                    }
                    parentHash = parentH.hash;
                    epoch -= 1;
                    break;
                }
                delay = await measure.call('save', ()=>processEpoch(epoch , data, taskBegin));
                if (parentHash) {
                    parentHash = data.pivotHash
                }
                if (data.code === 0) {
                    if (epoch % 100 === 0) {
                        measure.dump(` ${epoch} sync cfx trs : `, 1, 'epoch', 'save');
                    }
                    epoch++;
                }
                break;
            case "wait":
                console.log(`fetch result is 'wait'.`)
                delay = 5_000;
                break;
        }
        if (epoch < stopBeforeEpoch) {
            setTimeout(repeat, delay)
        } else {
            await finishTask(taskBegin, TaskCfxTransfer);
            endFn()
        }
    }
    repeat().then()
}
const measure = new Measure()
// noinspection DuplicatedCode
async function runTask(cfx:Conflux, fromEpoch:number = 0, len) {
    const task = await fetchTask(len, fromEpoch, cfx, TaskCfxTransfer)
    console.log(` start cfx transfer task, [${task.epoch}, ${task.range+task.epoch}), len ${task.range
    }, cursor/first epoch ${task.cursor + 1}`)
    if (fromEpoch === -1) {
        // -1 means 'continue unfinished task',
        // switch to normal(support multiple) after the first task is picked up.
        fromEpoch = 1
    }
    await new Promise(r=>{
        run(cfx, task, ()=>{
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
    regExitHook()
    setup().then()
}
