import {Transaction, Model,DataTypes, Sequelize, Op, UniqueConstraintError, ModelStatic} from "sequelize";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {batchTraceBlock, patchHttpProvider, removeLongData} from "./service/common/utils";
import {Measure} from "./service/common/Measure";
import {IEpochTask} from "./service/UniqueAddressStat";
import {fetchTask} from "./TokenTransferSync";
import {FullTransaction} from "./model/FullBlock";
import {makeIdV} from "./model/HexMap";
import {AddressCfxTransfer, CfxTransfer, doMark, ICfxTransfer, popPartitionCfxTransfer} from "./model/CfxTransfer";
import {sleep} from "./service/tool/ProcessTool";
import {finishTask, IEpochTokenTransfer, waitParentHashDB} from "./TokenTransferSync";
import {PreLoader} from "./service/common/PreLoader";
import {KEY_FULL_CFX_TRANSFER_COUNT, KV} from "./model/KV";


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
async function getCfxTransferTraces(epoch: number)
    : Promise<{result?:ICfxTransfer[], code?: number, addrBeans?:any[], pivotHash?:string, parentHash?:string}>{
    const cfx = cfx0;
    const [hashes, txInDb, maxTx, pivotBlock] = await Promise.all([
        cfx.getBlocksByEpochNumber(epoch),
        FullTransaction.findAll({
            where: {epoch}, order: [['blockPosition', 'asc'],['txPosition', 'asc']]
        }).then(list=>{
            const txMap = new Map<string, FullTransaction>()
            list.forEach(tx=>{
                txMap.set(`${tx.blockPosition}-${tx.txPosition}`, tx)
            })
            return txMap
        }),
        FullTransaction.findOne({order:[['epoch','desc']]}),
        cfx.getBlockByEpochNumber(epoch, false)
    ])
    if (maxTx === null || epoch > maxTx.epoch) {
        return {code: 404}
    }
    if (txInDb.size === 0) {
        return {result: [], addrBeans: [], code: 0, pivotHash: pivotBlock.hash, parentHash: pivotBlock.parentHash};
    }
    const result:ICfxTransfer[] = [];
    const addrBeans = []
    const traceArray2d:any[] = await batchTraceBlock(cfx, hashes);
    for (let blkIdx = 0; blkIdx < traceArray2d.length; blkIdx++) {
        const {blockHash, epochNumber, transactionTraces} = traceArray2d[blkIdx];
        const txArr = transactionTraces as any[]
        for (let txIdx = 0; txIdx < txArr.length; txIdx++) {
            let txKey = `${blkIdx}-${txIdx}`;
            const txBean = txInDb.get(txKey)
            txInDb.delete(txKey)
            if (!txBean || txBean.status !== 0) {
                continue
            }
            const {traces, transactionHash, transactionPosition} = txArr[txIdx];
            if (txBean.hash !== transactionHash) {
                console.log(`rpc txHash ${transactionHash} != ${txBean.hash} in db. \n epoch ${epoch
                }, block idx ${blkIdx}, tx idx ${txIdx}`)
                process.exit(9)
            }
            const traceArr = traces as any[];
            for (let traceIdx = 0; traceIdx < traceArr.length; traceIdx++) {
                const {action:{outcome, from, to, value, callType}, type} = traceArr[traceIdx]
                if (!value
                    || callType === 'none'
                    || callType === 'callcode'
                    || callType === 'delegatecall'
                    || callType === 'staticcall'
                ) {
                    continue
                }
                if (callType !=='call' && type === 'call') {
                    console.log(`unknown call type ${callType} type ${type}, epoch ${epoch} block ${blockHash
                    } tx ${transactionPosition} ${transactionHash},  trace ${traceIdx}`)
                    process.exit(8)
                    return
                }
                if (type === 'internal_transfer_action') {
                } else if (type === 'create' || type ==='call') {
                } else if (type === 'create_result' || type ==='call_result') {
                    //value should be zero, won't trigger
                } else {
                    console.log(`unknown trace type ${type}, epoch ${epoch} block ${blockHash
                    } tx ${txIdx}, trace ${traceIdx}`)
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
    if (txInDb.size !== 0) {
        // all tx should be matched and removed in map.
        console.log(`db has more tx, remain ${txInDb.size}, epoch ${epoch}, trace count ${result.length}.`)
        console.log(` ${[...txInDb.values()].map(tx=>`${tx.blockPosition}-${tx.txPosition}, ${tx.hash}`)}`)
        process.exit(9)
    }
    // removeLongData(traceArray2d);
    // console.log(JSON.stringify(traceArray2d, null, 4))
    return {result, addrBeans, code: 0, pivotHash: pivotBlock.hash, parentHash: pivotBlock.parentHash}
}
async function setup() {
    const [, , cfxUrl, fromEpoch, taskLen] = process.argv
    const cfx = new Conflux({url: cfxUrl})
    patchHttpProvider(cfx, {url: cfxUrl})
    await cfx.updateNetworkId();
    const st = await cfx.getStatus()
    await init()
    cfx0 = cfx;
    console.log(`----------${st.networkId}---------`)
    return runTask(cfx, parseInt(fromEpoch), parseInt(taskLen))
}
async function test() {
    const {addrBeans, result, code} = await getCfxTransferTraces(33690933)
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
    console.log(` ph ${pivotHash}`)
    return TaskCfxTransfer.sequelize.transaction(async dbTx=>{
        return Promise.all([
            KV.diffCount(KEY_FULL_CFX_TRANSFER_COUNT, result.length, dbTx, ),
            CfxUser.bulkCreate(result, {transaction: dbTx}),
            CfxTransfer.bulkCreate(result, {transaction: dbTx}),
            AddressCfxTransfer.bulkCreate(addrBeans, {transaction: dbTx}),
            EpochHashCfxTransfer.create({epoch, hash: pivotHash},{transaction: dbTx}),
            TaskCfxTransfer.update(
                {cursor: epoch, },
                {where:{epoch:taskBegin}, transaction:dbTx}),
        ]).then(([rows,])=>{
            return doMark(rows, epoch, console)
        })
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

    const loader = new PreLoader(cfx, getCfxTransferTraces, 3, stopBeforeEpoch);
    loader.preLoadSize = 10;
    // should not higher than tx sync, otherwise the transaction hash may can not be found.
    let epoch = fromEpoch;
    let maxEpochInTx = 0;
    async function updateMaxTxEpoch() {
        const maxE = await FullTransaction.max('epoch')
        if (typeof maxE !== 'number') {
            return;
        }
        maxEpochInTx = maxE;
    }
    await updateMaxTxEpoch()
    async function repeat() {
        return repeat0().catch(err=>{
            console.log(` repeat error : `, err)
            return new Promise(r=>setTimeout(r, 10_000))
        })
    }
    async function repeat0() {
        if (epoch > maxEpochInTx) {
            await updateMaxTxEpoch();
            setTimeout(repeat, 5_000)
            return;
        }
        let {action, data} = await measure.call('epoch', () => loader.get(epoch));
        let delay = 0
        switch (action) {
            case "ok":
                if (data instanceof Error) {
                    console.log(` error at epoch ${epoch}`, data)
                    delay = 5_000;
                    break;
                }
                console.log(` epoch ${epoch}, code ${data.code}, parentHash ${parentHash}`, data)
                if (data.code === 0 && parentHash && parentHash !== data.parentHash) {
                    console.log(` parent hash not match epoch ${epoch}, want ${parentHash}, actual ${data.pivotHash
                    }`)
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
                delay = await processEpoch(epoch , data, taskBegin);
                if (parentHash) {
                    parentHash = data.pivotHash
                }
                if (data.code === 0) {
                    epoch++
                }
                break;
            case "wait":
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
    console.log(` start token transfer task, [${task.epoch}, ${task.range+task.epoch}), len ${task.range
    }, cursor/first epoch ${task.cursor + 1}`)
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
    setup().then()
}