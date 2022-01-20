import {
    getTokenTool,
    IEpochTask,
} from "./service/UniqueAddressStat";
import {Transaction, Model,DataTypes, Sequelize, Op, UniqueConstraintError, ModelStatic} from "sequelize";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "./service/common/utils";
import {Measure} from "./service/common/Measure";
import {TransactionReceipt} from "js-conflux-sdk/types/rpc";
import {TokenTool} from "./service/tool/TokenTool";
import {
    AddressErc20Transfer,
    aggregateTransfer,
    buildErc20Transfer, buildTransferList2address, ContractUser,
    Erc20Transfer,
} from "./model/Erc20Transfer";
import {AddressErc721Transfer, buildErc721Transfer, Erc721Transfer} from "./model/Erc721Transfer";
import {AddressErc1155Transfer, Erc1155Transfer} from "./model/Erc1155Transfer";
import {KV} from "./model/KV";
import {CheckPivotHashError, PreLoader} from "./service/common/PreLoader";
import {sleep} from "./service/tool/ProcessTool";
import {NftMint} from "./model/Token";
import {PruneNotifier} from "./service/prune/PruneNotifier";
import {PruneType} from "./model/PruneInfo";
import {RedisWrap} from "./service/RedisWrap";
import {FullTransaction} from "./model/FullBlock";

export interface IEpochHashTokenTransfer {
    epoch:number
    hash:string
}
// used to find parent hash when popping
export class EpochHashTokenTransfer extends Model<IEpochHashTokenTransfer>
implements IEpochHashTokenTransfer{
    epoch:number
    hash:string
    static register(seq: Sequelize) {
        EpochHashTokenTransfer.init({
            epoch : {type: DataTypes.BIGINT({unsigned: true}), primaryKey: true},
            hash: {type: DataTypes.CHAR(66), allowNull: false},
        },{
            sequelize: seq, tableName: 'epoch_hash_token_transfer',
            updatedAt: false,
        })
    }
}
export interface IEpochTokenTransfer extends IEpochTask {
    cursor:number
    checkPivot?: boolean
}
export class EpochTaskTokenTransfer extends Model<IEpochTokenTransfer> implements IEpochTokenTransfer{
    epoch: number
    range: number
    createdAt: Date
    updatedAt: Date
    finished: boolean

    cursor: number;
    static register(seq: Sequelize) {
        EpochTaskTokenTransfer.init({
            epoch: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true},
            cursor: {type: DataTypes.BIGINT, allowNull: false},
            range: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
            finished: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
        },{
            sequelize: seq, tableName: 'task_token_transfer',
        })
    }
}

function decodeTransferFromReceipts(receipts2d:TransactionReceipt[][],tokenTool: TokenTool,
                                    dt:Date, blockHashes:string[]) {
    const result = {t20:[],t721:[],t1155:[]}
    function push(arr:any[], transfer, blockIdx, tx:TransactionReceipt, txLogIndex, txPos) {
        transfer['epoch'] = tx.epochNumber;
        transfer['transactionIndex'] = txPos;//tx.index;
        transfer['transactionLogIndex'] = txLogIndex;
        transfer['blockIndex'] = blockIdx;
        transfer['createdAt'] = dt;
        arr.push(transfer)
    }
    let blockIdx = -1;
    for (let receiptsInBlock of receipts2d) {
        blockIdx ++
        let txPos = -1; // match with the logic in TransactionSync.
        for (let txReceipt of receiptsInBlock) {
            if (txReceipt.outcomeStatus === 0) {
                txPos ++ // inc for status 0
            } else if (txReceipt.outcomeStatus === 1) {
                txPos ++ // inc for status 1 (failed)
                continue;
            } else { // null: not executed; 2: skipped.
                continue;
            }
            if (txReceipt.blockHash !== blockHashes[blockIdx]) {
                throw new Error(`tx receipt has mismatch block hash, epoch ${txReceipt.epochNumber
                }, ${txReceipt.blockHash
                } vs block hashes ${blockHashes[blockIdx]}`)
            }
            let txLogIndex = -1;
            for (let log of txReceipt.logs) {
                txLogIndex ++
                if (log.topics.length < 3) {
                    continue;
                }
                const {topics: [, t1, t2, ]} = log;
                if (t1 === undefined || t2 === undefined) {
                    continue
                }
                let transfer;
                if ((transfer = tokenTool.decodeERC20TransferPlus(log, false))) {
                    push(result.t20, transfer, blockIdx, txReceipt, txLogIndex, txPos)
                } else if ((transfer = tokenTool.decodeERC721Transfer(log, false))) {
                    push(result.t721, transfer, blockIdx, txReceipt, txLogIndex, txPos);
                } else if ((transfer = tokenTool.decodeERC1155TransferArrayPlus(log))) {
                    transfer.forEach(e=>{
                        push(result.t1155, e, blockIdx, txReceipt, txLogIndex, txPos);
                    })
                }
            }
        }
    }
    return result;
}
async function batchSaveTransfer(mainModel, addrModel, arr, dataForAddr, dbTx) {
    return Promise.all([
        mainModel.bulkCreate(arr, {transaction: dbTx}),
        addrModel.bulkCreate(dataForAddr, {transaction: dbTx}),
        ContractUser.bulkCreate(arr, {transaction: dbTx}),
    ])
}
async function waitParentHashDB(task: IEpochTokenTransfer, parentEpoch:number) : Promise<string> {
    if (!task.checkPivot) {
        return ''
    }
    if (parentEpoch === -1) {
        return '-'
    }
    do {
        const formerOne = await EpochHashTokenTransfer.findByPk(parentEpoch);
        if (formerOne === null) {
            console.log(` current task with epoch ${task.epoch
            } says: former task not finished yet, want epoch ${parentEpoch} be finished.`)
            await sleep(5_000)
            continue
        }
        return formerOne.hash;
    } while (true)
}
const simulateSwitchEpochs = new Set<number>();
function simulatePivotSwitch(epoch:number, mod) {
    if (epoch % mod !== 0) {
        return
    }
    if (simulateSwitchEpochs.has(epoch)) {
        return
    }
    simulateSwitchEpochs.add(epoch);
    throw new CheckPivotHashError(`simulate pivot switch ${epoch}.`)
}
const measure = new Measure()
const dumpPerRound = parseInt(process.env.ROUND || '1000')
async function run(cfx:Conflux, task:IEpochTokenTransfer, endFn:()=>void) {
    const fromEpoch = task.cursor+1;
    const stopBeforeEpoch = task.epoch + task.range
    const taskBegin = task.epoch;
    const {tokenTool} = getTokenTool(cfx)
    // parentHash, also indicates whether checking parent hash.
    let parentHash = await waitParentHashDB(task, task.cursor)
    async function buildTransfer(arr:any[], fn, dt) {
        const contractIds = new Set<number>()
        const addrIds = new Set<number>()
        for (let e of arr) {
            await fn(e, dt)
            contractIds.add(e.contractId)
            addrIds.add(e.fromId)
            addrIds.add(e.toId)
        }
        return {contractIds: [...contractIds], addrIds: [...addrIds]}
    }
    function buildNfts(list, arr) {
        list.forEach(t=>{
            t.updatedAt = t.createdAt
            arr.push(t)
        })
    }
    async function fetchAndBuild(epoch: number) {
        const [receipts, blockHashes, block] = await Promise.all([
            cfx.getEpochReceipts(epoch).then(res=>{
                if (res === null && epoch === 0) {
                    res = []
                }
                return res;
            }),
            cfx.getBlocksByEpochNumber(epoch),
            cfx.getBlockByEpochNumber(epoch),
        ])
        const pivotHash = block.hash;
        if (pivotHash !== blockHashes[blockHashes.length - 1]) {
            throw new CheckPivotHashError(` epoch ${epoch}, block hash mismatch at epoch ${epoch
            }, from pivot block ${pivotHash}, from block hashes ${blockHashes[blockHashes.length - 1]}`)
        }
        // simulatePivotSwitch(epoch, 3)
        const dt = new Date(block.timestamp * 1000);
        const {t20:t20raw, t721, t1155} = decodeTransferFromReceipts(receipts, tokenTool, dt, blockHashes);
        const t20 = aggregateTransfer(t20raw)
        // after all id is cached, it's almost cpu computation.
        const ids20 = await buildTransfer(t20, buildErc20Transfer, dt);
        const ids721 = await buildTransfer(t721, buildErc721Transfer, dt);
        const ids1155 = await buildTransfer(t1155, buildErc721Transfer, dt);
        const nfts = []
        buildNfts(t721, nfts)
        buildNfts(t1155, nfts)
        // build data out of transaction, reduce tx time.
        const [t20addr, t721addr, t1155addr] = [t20, t721, t1155].map(buildTransferList2address)
        return {t20, t20addr, t721, t721addr, t1155, t1155addr, nfts, ids20, ids721, ids1155, dt, pivotHash, parentHash: block.parentHash}
    }
    const fetchAndBuildTag = 'fetchAndBuild';
    async function processData(epoch, finalData) {
        try {
            await measure.call('save', () => save(epoch, finalData as any, taskBegin))
        } catch (e) {
            console.log(` processData catch it, epoch ${epoch}, ${e.message}`)
            return Promise.reject(e)
        }
        if (parentHash) { // checking mode.
            parentHash = finalData['pivotHash'];
        }
        async function notifyPrune(type, {contractIds, addrIds}, addrType) {
            if (contractIds.length === 0) {
                return;
            }
            return Promise.all([
                PruneNotifier.notifyPrune({[type]:contractIds}),
                PruneNotifier.notifyPrune({[addrType]:addrIds}),
            ]);
        }
        try {
            notifyPrune(PruneType.ERC20_TRANSFER, finalData.ids20, PruneType.ADDR_ERC20_TRANSFER).then()
            notifyPrune(PruneType.ERC721_TRANSFER, finalData.ids721, PruneType.ADDR_ERC721_TRANSFER).then()
            notifyPrune(PruneType.ERC1155_TRANSFER, finalData.ids1155, PruneType.ADDR_ERC1155_TRANSFER).then()
        } catch (e) {
            console.log(`notify prune fail:`, e)
        }
        return finalData;
    }
    let epoch = fromEpoch;
    async function localPop(ep) {
        /**
         epoch    : current epoch should be processed, but failed because pivot switch,
         epoch - 1: previous/parent epoch, with pivot hash != (parentHash of current epoch), pop it.
         epoch - 2: after (epoch - 1) is popped, it will be the top element on the stack. use its pivot
                    hash as 'parentHash'.
         */
        console.log(` local pop ${ep}`)
        await pop(ep, taskBegin)
        epoch = ep
        console.log(` set cursor to ${epoch}`)
        parentHash = await waitParentHashDB(task, ep - 1)
        console.log(` local pop ${ep} end -`)
        return ep
    }
    const loader = new PreLoader(cfx, fetchAndBuild, 3, stopBeforeEpoch);
    loader.preLoadSize = 10;
    // should not higher than tx sync, otherwise the transaction hash may can not be found.
    let maxEpochInTx = 0;
    async function updateMaxTxEpoch() {
        const maxE = await FullTransaction.max('epoch')
        if (typeof maxE !== 'number') {
            console.log(` FullTransaction is empty. ${new Date().toISOString()}`)
            return;
        }
        maxEpochInTx = maxE;
    }
    await updateMaxTxEpoch()
    let firstWait = true
    async function repeat() {
        return repeat0().catch(err=>{
            console.log(` repeat error : `, err)
        })
    }
    async function repeat0() {
        if (epoch>maxEpochInTx) {
            await updateMaxTxEpoch();
            setTimeout(repeat, 5_000)
            return;
        }
        let {action, data} = await measure.call('epoch', ()=>loader.get(epoch));
        let delay = 0
        switch (action) {
            case "ok":
                try {
                    if (data instanceof CheckPivotHashError) {
                        console.log(` checking pivot hash error, ${data.message}`);
                        await  localPop(epoch - 1)
                        break;
                    } else if (parentHash && data.parentHash !== parentHash) {
                        console.log(` before save check, parent hash not match, on hand epoch ${epoch
                        } with PH ${data.parentHash} != ${parentHash} (parent)`)
                        await  localPop(epoch - 1)
                        break;
                    }
                    await processData(epoch, data)
                    if (epoch % dumpPerRound === 0) {
                        console.log(` sync transfer sample log, at epoch ${epoch}`);
                        measure.dump(` ------ sync transfer metrics: `, 1, 'epoch', fetchAndBuildTag, 'save');
                    }
                    epoch ++
                } catch (e) {
                    if (e instanceof UniqueConstraintError) {
                        console.log(` UniqueConstraintError, epoch ${epoch}, ${e.message}`, e)
                        await localPop(epoch);
                        break;
                    }
                    console.log(`process epoch fail at ${epoch}, task start epoch ${taskBegin}, `, e)
                    process.exit(1)
                }
                break;
            case "wait":
                if (firstWait) {
                    firstWait = false
                }else {
                    delay = 5_000;
                }
                break;
            case "pop":
                break;
        }
        if (epoch < stopBeforeEpoch) {
            setTimeout(repeat, delay)
        } else {
            await finishTask(taskBegin);
            endFn()
        }
    }
    repeat().then()
}
async function finishTask(epoch) {
    await EpochTaskTokenTransfer.update({finished: true}, {where: {epoch}})
    console.log(` ---- finish task ${epoch} ---- `)
}
async function save(epoch:number, {t20, t20addr, t721, t721addr, t1155, t1155addr, pivotHash, nfts}, taskBegin:number) {
    return KV.sequelize.transaction(dbTx=>{
        return Promise.all([
            batchSaveTransfer(Erc20Transfer, AddressErc20Transfer, t20, t20addr, dbTx),
            batchSaveTransfer(Erc721Transfer, AddressErc721Transfer, t721, t721addr, dbTx),
            batchSaveTransfer(Erc1155Transfer, AddressErc1155Transfer, t1155, t1155addr, dbTx),
            NftMint.bulkCreate(nfts, {transaction: dbTx,
                updateOnDuplicate:["updatedAt","toId","epoch","blockIndex","txIndex"],
            }),
            EpochHashTokenTransfer.create({epoch, hash: pivotHash},{transaction: dbTx}),
            EpochTaskTokenTransfer.update(
                {cursor: epoch, },
                {where:{epoch:taskBegin}, transaction:dbTx})
                // .then(res=>{
                //     console.log(` update cursor, epoch ${epoch} result `, res)
                // })
        ])
    })
}
const MAIN_TRANSFER_MODELS = [Erc20Transfer, Erc721Transfer, Erc1155Transfer]
async function pop(epoch:number, taskBegin: number) {
    async function prepare(model:any) {
        const mainList = await model.findAll({where: {epoch}})
        if (mainList.length === 0) {
            return []
        }
        const addrIds = new Set<number>();
        mainList.forEach(r=>{
            addrIds.add(r.fromId);
            addrIds.add(r.toId);
        })
        return [...addrIds]
    }
    const popRef = await Promise.all(
        MAIN_TRANSFER_MODELS.map(prepare)
    )
    async function popAction(mainModel , partitionModel, addrIdArr, dbTx) {
        // mainModel = Erc20Transfer;
        // partitionModel = AddressErc20Transfer;
        if (addrIdArr.length === 0) {
            return 'empty';
        }
        return Promise.all([
            mainModel.destroy({where: {epoch}, transaction:dbTx}).then((cnt)=>`M:${cnt}`),
            partitionModel.destroy({where: {addressId:{[Op.in]:addrIdArr}}, transaction:dbTx}).then((cnt)=>`P:${cnt}/${addrIdArr.length}`)
        ]);
    }
    async function popTaskCursor(dbTx: Transaction) {
        // cursor could less than the start epoch of this task. doesn't matter.
        // there should be only one task under execution.
        return EpochTaskTokenTransfer.update({cursor: epoch - 1},
            {where: {epoch: taskBegin}, limit: 1, transaction:dbTx}
            )
    }
    return EpochTaskTokenTransfer.sequelize.transaction(dbTx=>{
        return Promise.all([
            popAction(Erc20Transfer, AddressErc20Transfer, popRef[0], dbTx).then(res=>`t20 ${res}`),
            popAction(Erc721Transfer, AddressErc721Transfer, popRef[1], dbTx).then(res=>`t721 ${res}`),
            popAction(Erc1155Transfer, AddressErc1155Transfer, popRef[2], dbTx).then(res=>`t1155 ${res}`),
            EpochHashTokenTransfer.destroy({where: {epoch}, limit: 1, transaction: dbTx}).then((cnt)=>`PH ${cnt}`),
            popTaskCursor(dbTx).then((cnt)=>`CURSOR ${cnt}`),
        ])
    }).then(res=>{
        console.log(` pop done. epoch ${epoch}, ${JSON.stringify(res)}`)
        return res;
    })
}
async function fetchTask(len:number, fromEpoch: number, cfx:Conflux ) : Promise<IEpochTokenTransfer> {
    do {
        const [maxOne, exactOne] = await Promise.all([
            EpochTaskTokenTransfer.findOne({order:[['epoch','desc']]}),
            EpochTaskTokenTransfer.findOne({where: {epoch: fromEpoch, finished: false}}), // resume exists task
        ])
        if (exactOne) {
            console.log(` resume exists task ${exactOne.epoch}, cursor ${exactOne.cursor}`)
            return exactOne;
        }
        if (fromEpoch === -1 && maxOne.finished === false) {
            console.log(` continue unfinished task, epoch ${maxOne.epoch}, cursor ${maxOne.cursor}`)
            return maxOne; // continue unfinished task.
        }
        let preEnd = fromEpoch;
        if (maxOne !== null) {
            preEnd = maxOne.epoch + maxOne.range
        }
        // check whether need new task.
        const stateEpoch = await joinTask(preEnd, cfx, len * 2)
        const checkPivot = stateEpoch - preEnd < len * 2 || FORCE_CHECK_PIVOT
        const now = new Date();
        const newOne:IEpochTokenTransfer = {epoch: preEnd, range: len,
            cursor: preEnd - 1, checkPivot,
            finished: false, createdAt: now, updatedAt: now}
        let ok = false
        await EpochTaskTokenTransfer.create(newOne).then(()=>{
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
// noinspection DuplicatedCode
async function setup(cfxUrl:string, fromEpoch = '30495000', taskLen = '3000') {
    const config = await init();
    await RedisWrap.connect(config.redis)
    console.log(`--------------------`)

    const cfxOp = cfxUrl ? {url: cfxUrl} : config.conflux
    let cfx = new Conflux(config.conflux)
    patchHttpProvider(cfx, cfxOp)
    const st = await cfx.getStatus()
    console.log(` ${process.argv[1]} \n network ${st.networkId}`)
    return runTask(cfx, parseInt(fromEpoch), parseInt(taskLen))
}
async function joinTask(targetEpoch:number, cfx: Conflux, dist:number) {
    let stateEpoch: number;
    do {
        stateEpoch = await cfx.getEpochNumber('latest_state').catch(()=>{
            return 0
        });
    } while (stateEpoch === 0)
    if (stateEpoch - targetEpoch >  dist) {
        return stateEpoch;
    }
    const formerOne = await EpochTaskTokenTransfer.findOne({
        where: {
            finished: false,
            // do not search all record in the table, limit its range.
            epoch:{[Op.between]:[targetEpoch - dist,targetEpoch]}
            },
        order: [['epoch', 'desc']]
    })
    if (formerOne === null) {
        return stateEpoch;
    }
    if (formerOne.cursor - formerOne.epoch > formerOne.range / 2) {
        // half progress, will finish soon.
        return stateEpoch;
    }
    // there is a task that near the latest_state epoch, and its progress is less than half,
    // so, abort new task, and quit.
    console.log(` quit this worker. former task from epoch ${formerOne.epoch} with cursor ${
        formerOne.cursor}, latest_state epoch ${stateEpoch}`)
    process.exit(0)
}
// noinspection DuplicatedCode
async function runTask(cfx:Conflux, fromEpoch:number = 0, len) {
    const task = await fetchTask(len, fromEpoch, cfx)
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
const FORCE_CHECK_PIVOT = Boolean(process.env.FORCE_CHECK_PIVOT)
if (module === require.main) {
    // fromEpoch:
    // -1 : use former unfinished task; exclude mode.
    // N  : use task N if it's not finished, fallback to *.
    // *  : auto create based on max task.
    const [, , cfxUrl, fromEpoch, taskLen] = process.argv
    if (process.argv.includes('prune')) {
        PruneNotifier.SWITCH_SYNC_PRUNE = true;
    }
    setup(cfxUrl, fromEpoch, taskLen).then().catch(err => {
        console.log(`${process.argv[1]}\n`, err)
        process.exit(1)
    });
}