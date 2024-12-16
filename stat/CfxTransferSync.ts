import {redirectLog} from "./config/LoggerConfig";
import {Model,DataTypes, Sequelize, Op} from "sequelize";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {batchTraceBlock, initCfxSdk} from "./service/common/utils";
import {Measure} from "./service/common/Measure";
import {FullBlock, FullTransaction, loadMaxBlockEpoch} from "./model/FullBlock";
import {idHex40Map, makeIdV, makeVirtualContractInfo, patchPocketAddress, POCKET_ADDRESS_MAP} from "./model/HexMap";
import {
    AddressCfxTransfer, CFX_TRANSFER_PAGE_MARK_SIZE,
    CfxTransfer, checkCfxTransferCountKV,
    ICfxTransfer,
    markCfxTransferPosition,
    popPartitionCfxTransfer, scheduleRollupDailyCfxTxn
} from "./model/CfxTransfer";
import {regExitHook, sleep} from "./service/tool/ProcessTool";
import {diffCount, KEY_FULL_CFX_TRANSFER_COUNT} from "./model/KV";
import {CfxWatcher} from "./service/watcher/BalanceWatcher";
import {scheduleCrossSpaceStat} from "./service/CrossSpaceStat";
import {rmCache} from "./service/common/RpcCacheManager";
import {BatchCfxTransfer, CfxTransferEpochData} from "./service/BatchDBTx";
import {PreloadMap} from "./service/SyncBase";
import {FirstBlockNo} from "./config/StatConfig";

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

let cfx0:Conflux
export function setCfxSync(cfx: Conflux) {
    cfx0 = cfx
}
export async function getCfxTransferTraces(epoch: number)
    : Promise<CfxTransferEpochData>{
    const cfx = cfx0;
    // speed up in case no transaction in epoch.
    const _dbTx = batchData.enable ? await FullBlock.sequelize.transaction() : undefined;
    const [txMapByHash, blockArrDb, pivotBlock] = await Promise.all([FullTransaction.findAll({
            where: {epoch}, order: [['blockPosition', 'asc'],['txPosition', 'asc']],
            transaction: _dbTx,
        }).then(list=>{
            const txMap = new Map<string, FullTransaction>()
            list.forEach(tx=>{
                txMap.set(tx.hash, tx)
            })
            return txMap
        }),
        FullBlock.findAll({where: {epoch}, order:[['position','asc']], raw: true, transaction: _dbTx,}),
        cfx.getBlockByEpochNumber(epoch),
    ])
    if (_dbTx) {
        _dbTx.rollback().catch()
    }
    if (blockArrDb.length == 0) {
        console.log(`no block in db, epoch ${epoch}`);
        return {code: 404};
    }
    const dbPBH = blockArrDb[blockArrDb.length-1].hash;
    if (pivotBlock.hash != dbPBH) {
        console.log(`rpc pivotBlock.hash ${pivotBlock.hash}`)
        console.log(`db  pivot has ${dbPBH} mismatch , epoch ${epoch}`)
        return {code: 404}
    }
    if (txMapByHash.size === 0 && batchData.enable) {
        // catchup mode, shortcut when tx in db was empty.
        return {result: [], addrBeans: [], code: 0, pivotHash: dbPBH, parentHash: pivotBlock.parentHash, epoch};
    }

    const hashes = blockArrDb.map(blk=>blk.hash);
    const result:ICfxTransfer[] = [];
    const addrBeans = []
    const traceArray2d:any[] = await batchTraceBlock(cfx, hashes);
    for (let blkIdx = 0; blkIdx < traceArray2d.length; blkIdx++) {
        let traceOfBlock = traceArray2d[blkIdx];
        if (traceOfBlock === null) {
            continue
        }
        const {blockHash, transactionTraces, epochHash, epochNumber} = traceOfBlock;
        if (epoch != epochNumber) {
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
                        // scan doesn't save gas/storage payment as cfx transfer records.
                        fromPocket === 'gas_payment' || toPocket === 'gas_payment' // save it except gas
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
    return {result, addrBeans, code: 0, pivotHash: pivotBlock.hash, parentHash: pivotBlock.parentHash, epoch}
}
async function setup() {
    const [, , cmd, fromEpoch, ] = process.argv
    const config = await init()
    await checkCfxTransferCountKV()
    const cfxOpt = config.cfxTransferRpc;
    if (fromEpoch === 'holder') {
        redirectLog({subPath:'.holder'})
        const cfx = await initCfxSdk(cfxOpt);
        await runHolder(cfx);
        return;
    } else if (cmd === 'marker') {
        redirectLog({subPath:'.marker'})
        await runMarker();
        return;
    }
    redirectLog()
    const cfx = await initCfxSdk(cfxOpt);
    setTimeout(()=>runHolder(cfx).then(), 5_000);
    runMarker().then();
    cfx0 = cfx;
    await makeVirtualContractInfo(cfx.networkId);
    scheduleRollupDailyCfxTxn().then();
    console.log(`---------- ${cfxOpt.url} ${cfx.networkId} ---------`)
    if (process.argv.includes('test')) {
        await test(parseInt(fromEpoch))
        process.exit(0)
    } else {
        scheduleCrossSpaceStat(cfx).then()
        return runTask(cfx)
    }
}
async function test(ep:number) {
    const {addrBeans, result, code} = await getCfxTransferTraces(ep)
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

const batchData = new BatchCfxTransfer();

async function save(data:CfxTransferEpochData) {
    measure.count('addrBeans', data.addrBeans.length);
    batchData.enqueue(data)
    if (batchData.shouldWaitBatch()) {
        return;
    }
    return CfxTransfer.sequelize.transaction(async dbTx=>{
        return Promise.all([
            diffCount(KEY_FULL_CFX_TRANSFER_COUNT, batchData.transferCount, dbTx, ),
            CfxUser.bulkCreate(batchData.cfxTransArr, {transaction: dbTx}),
            CfxTransfer.bulkCreate(batchData.cfxTransArr, {transaction: dbTx}),
            AddressCfxTransfer.bulkCreate(batchData.addrBeans, {transaction: dbTx}),
            EpochHashCfxTransfer.bulkCreate(batchData.pivotHashArr,{transaction: dbTx}),
        ]).then(()=>{
            batchData.reset();
        })
    })
}
async function pop(epoch: number) {
    if (batchData.batchSize > 0) {
        console.log(`${__filename} batch size is ${batchData.batchSize} but re-org detected. epoch ${epoch}`)
        // restart
        process.exit(0)
    }
    return CfxTransfer.sequelize.transaction(async dbTx=>{
        return Promise.all([
            EpochHashCfxTransfer.findByPk(epoch-1),
            popPartitionCfxTransfer(epoch, undefined, dbTx),
            EpochHashCfxTransfer.destroy({where: {epoch}, transaction: dbTx}),
        ])
    });
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
let lastNoUserLogMinute = -1
async function holder() {
    if (batchData.enable) {
        return sleep(60_000);
    }
    const list = await CfxUser.findAll({order:[['id','asc']], limit: 100});
    if (list.length === 0) {
        const minutes = new Date().getMinutes();
        if (minutes != lastNoUserLogMinute) {
            console.log(`HOLDER: cfx user table is empty.`)
            lastNoUserLogMinute = minutes;
        }
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
        return sleep(60_000)
    });
    setTimeout(runMarker, 0)
}
let preMarkEpoch = 0;
let noTaskLogMinute = -1
async function marker() {
    const top = await EpochHashCfxTransfer.findOne({order:[['epoch', 'desc']]});
    if (!top) {
        const m = new Date().getMinutes();
        if (m != noTaskLogMinute) {
            console.log(` no info in db. `)
            noTaskLogMinute = m;
        }
        await sleep(50_000)
        return;
    }
    if (top.epoch < preMarkEpoch + 1_000) {
        console.log(`MARKER: no [NEW] task info in db, pre mark ${preMarkEpoch}`)
        await sleep(60_000)
        return;
    }
    let avoidReOrg = 1000;
    await markCfxTransferPosition(CFX_TRANSFER_PAGE_MARK_SIZE, top.epoch - avoidReOrg);
    preMarkEpoch = top.epoch;
    console.log(`mark done. epoch ${top.epoch}`)
}
// counter , handle multiple task situation.
async function processEpoch(data:CfxTransferEpochData) {
    const {code} = data;
    if (code === 404) {
        return 5_000;
    } else if (code !== 0) {
        return 10_000
    }
    await save(data)
    return 0;
}

export async function loadParentHash(fromEpoch: number, preFinished: number, model:{findOne:(p:{where: { epoch: number }})=>Promise<{hash: string}>}) {
    let parentHash = '-'
    if (fromEpoch > FirstBlockNo) {
        const hashBean = await model.findOne({where: {epoch: preFinished}});
        if (hashBean) {
            parentHash = hashBean.hash
        } else {
            const pb = await FullBlock.findOne({where: {epoch: preFinished, pivot: true}});
            if (pb) {
                parentHash = pb.hash;
            } else {
                console.log(`pre pivot block in db not found, epoch ${preFinished}`);
                await sleep(5_000)
                process.exit(0);
            }
        }
    }
    return parentHash;
}

async function run(cfx:Conflux, preFinished: number) {
    const fromEpoch = preFinished + 1;
    let parentHash = await loadParentHash(fromEpoch, preFinished, EpochHashCfxTransfer);
    const loader = new PreloadMap(getCfxTransferTraces, batchData.initialTaskCount);
    // should not higher than tx sync, otherwise the transaction hash may can not be found.
    let epoch = fromEpoch;
    const stateEpoch = await cfx.getEpochNumber('latest_state')
    let maxEpochOfBlock = 0;
    async function updateMaxDbEpoch() {
        const maxE = await loadMaxBlockEpoch()
        if (typeof maxE !== 'number') {
            return;
        }
        maxEpochOfBlock = maxE;
    }
    await updateMaxDbEpoch()
    if (batchData.enableByGap(epoch, stateEpoch)) {
        loader.initTasks(epoch, batchData.initialTaskCount);
    }
    async function repeat() {
        return repeat0().catch(err=>{
            // DB failure, maybe.
            console.log(` repeat error at epoch ${epoch}: `, err)
            setTimeout(repeat, 10_000)
        })
    }
    async function repeat0() {
        if (epoch > maxEpochOfBlock) {
            console.log(` reach max block/tx epoch ${maxEpochOfBlock}`)
            await updateMaxDbEpoch();
            await EpochHashCfxTransfer.destroy({where: {epoch: {[Op.lt]: epoch - 10_000}}, limit: 5000});
            setTimeout(repeat, 5_000)
            return;
        }
        let data: CfxTransferEpochData = await measure.call('fetchData', () => loader.pop(epoch));
        let action = 'ok'
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
                if (data.code === 0 && parentHash !== data.parentHash && epoch != FirstBlockNo) {
                    console.log(` parent hash not match epoch ${epoch}, want ${parentHash}, actual ${data.pivotHash}`)
                    const [parentH] = await pop(epoch-1)
                    if (parentH === null) {
                        console.log(` after pop, parent hash bean is null, want epoch ${epoch - 2}`)
                        process.exit(9)
                    }
                    parentHash = parentH.hash;
                    await rmCache(cfx0.provider.conf.cachePath, epoch-1, true);
                    await rmCache(cfx0.provider.conf.cachePath, epoch, true);
                    epoch -= 1;
                    break;
                }
                delay = await measure.call('save', ()=>processEpoch(data));
                parentHash = data.pivotHash
                if (data.code === 0) {
                    if (stateEpoch - epoch > batchData.safeCatchupGap) {
                        loader.startNext()
                    } else {
                        batchData.enable = false
                    }
                    if (epoch % (batchData.enable ? 1000 : 100) === 0) {
                        measure.dump(` ${epoch} sync cfx trs ${batchData.enable ? "" : "NO "}batch, `, 1, 'save');
                    }
                    epoch++;
                }
                break;
        }
        setTimeout(repeat, delay)
    }
    repeat().then()
}
const measure = new Measure()
async function runTask(cfx:Conflux) {
    let hashBean = await EpochHashCfxTransfer.findOne({order:[['epoch','desc']]});
    const preFinished = hashBean?.epoch || FirstBlockNo - 1;
    console.log(` start cfx transfer task, first epoch ${preFinished + 1}`)
    return run(cfx, preFinished)
}
if (module === require.main) {
    regExitHook()
    setup().then()
}
