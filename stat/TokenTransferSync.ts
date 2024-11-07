import {redirectLog} from "./config/LoggerConfig";
import {
    getTokenTool,
    IEpochTask,
} from "./service/UniqueAddressStat";
import {
    Transaction,
    Model,
    DataTypes,
    Sequelize,
    Op,
    UniqueConstraintError,
    DatabaseError
} from "sequelize";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {batchFetchBlock, initCfxSdk} from "./service/common/utils";
import {Measure} from "./service/common/Measure";
import {TransactionReceipt} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {TokenTool} from "./service/tool/TokenTool";
import {
    AddressErc20Transfer,
    aggregateTransfer,
    buildErc20Transfer, buildTransferList2address, ContractUser,
    Erc20Transfer,
} from "./model/Erc20Transfer";
import {AddressErc721Transfer, buildErc721Transfer, Erc721Transfer} from "./model/Erc721Transfer";
import {AddressErc1155Transfer, Erc1155Transfer} from "./model/Erc1155Transfer";
import {KV, UNIFORM_APPROVAL_EPOCH} from "./model/KV";
import {CheckPivotHashError, PreLoader} from "./service/common/PreLoader";
import {regExitHook, sleep} from "./service/tool/ProcessTool";
import {NftMint, Token} from "./model/Token";
import {FullBlock, FullTransaction, loadMaxBlockEpoch} from "./model/FullBlock";
import {updateTransferCountReal} from "./StreamSync";
import {dingMsg} from "./monitor/Monitor";
import {FirstBlockNo} from "./config/StatConfig";
import {loadBlocksByEpoch, loadTxsByEpoch} from "./service/FullBlockService";
import {ApprovalRelation, batchSaveApproval, buildRelation, TaskEpochApproval, TokenApproval} from "./ApprovalSync";

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
            sequelize: seq, tableName: 'epoch_hash_token_transfer_3',
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
            sequelize: seq, tableName: 'task_token_transfer_3',
        })
    }
}

export function decodeTransferFromReceipts(receipts2d:TransactionReceipt[][],tokenTool: TokenTool,
                                    dt:Date, blockHashes:string[]) {
    const result = {t20:[],t721:[],t1155:[], approvals:[]}
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
                } else if ((transfer = tokenTool.decodeERC1155TransferArrayPlus(log)) && transfer.length) {
                    transfer.forEach(e=>{
                        push(result.t1155, e, blockIdx, txReceipt, txLogIndex, txPos);
                    })
                } else if ((transfer = tokenTool.decode721_1155_ApprovalForAll(log, false))) {
                    push(result.approvals, transfer, blockIdx, txReceipt, txLogIndex, txPos)
                } else if ((transfer = tokenTool.decodeERC721_ERC20Approval(log, false))) {
                    push(result.approvals, transfer, blockIdx, txReceipt, txLogIndex, txPos);
                }
            }
        }
    }
    return result;
}

export async function cfxSafeEpochReceipts(cfx: Conflux, epoch: number) {
    return cfx.getBlockByEpochNumber(epoch).then(blk=>{
        if (blk.epochNumber != epoch) {
            throw new Error(`rpc returns a block with epoch ${blk.epochNumber} , expect ${epoch}`);
        }
        return cfx.getEpochReceiptsByPivotBlockHash(blk.hash)
    }).then(res=>res as TransactionReceipt[][])
}

export async function loadEpoch(epoch: number, cfx: Conflux) {
    const tx = await FullBlock.sequelize.transaction();
        // load blocks and txs from db instead of rpc
    const [dbBlocks, dbTxArr, parentDbBlock] = await Promise.all([
                loadBlocksByEpoch(epoch, tx),
                loadTxsByEpoch(epoch, tx),
                FullBlock.findOne({where: {epoch: epoch-1}, transaction: tx})
            ]).finally(()=>tx.rollback());
    const blockHashes = dbBlocks.map(b=>b.hash);
    const block = dbBlocks[dbBlocks.length-1];
    const pivotHash = block.hash;
    const receipts = await cfx.getEpochReceiptsByPivotBlockHash(pivotHash).then(res=>{
        if (res === null && epoch === 0) {
            res = []
        }
        return res as TransactionReceipt[][];
    })
    await validate(epoch, dbBlocks, receipts, dbTxArr);


    // simulatePivotSwitch(epoch, 3)
    const dt = dbBlocks[dbBlocks.length-1].createdAt;
    return {pivotTime: dt, receipts, blockHashes, parentDbBlock, pivotHash}
}

export async function validate(epoch:number, dbBlocks:FullBlock[], receipts:TransactionReceipt[][], dbTxArr: FullTransaction[]) {
    if (epoch === 0) {
        return;
    }
    if (receipts === null) {
        throw new Error(`[epoch=${epoch}]validate, null receipts`);
    }
    if (dbBlocks.length !== receipts.length) {
        throw new Error(`[epoch=${epoch}]validate, mismatch length (blocks, receipts)`);
    }
    let dbTxPos = 0
    for (const [blockIndex, block] of dbBlocks.entries()) {
        const rcptOfBlock = receipts[blockIndex];
        for (const [txIndex, tx] of rcptOfBlock.entries()) {
            if (tx.outcomeStatus != 0 && tx.outcomeStatus != 1) {
                continue
            }
            if (tx.blockHash != block.hash) {
                throw new Error(`epoch ${epoch}, db block hash ${block.hash} != receipt block hash ${tx.blockHash}`)
            }
            const dbTx = dbTxArr[dbTxPos ++];
            if (!dbTx) {
                throw new Error(`epoch ${epoch} , miss db tx ${tx.transactionHash}`)
            }
            if (dbTx.hash != tx.transactionHash) {
                throw new Error(`epoch ${epoch} , db tx hash ${dbTx.hash} != receipt tx hash ${tx.transactionHash}`)
            }
            if (tx.epochNumber != epoch) {
                throw new Error(`epoch ${epoch} != receipt ${tx.epochNumber} `)
            }
        }
    }
    if (dbTxPos != dbTxArr.length) {
        throw new Error(`epoch ${epoch} , db has more tx than epochReceipt , ${dbTxPos} / ${dbTxArr.length}  `)
    }
}
async function batchSaveTransfer(mainModel, addrModel, arr, dataForAddr, dbTx) {
    return Promise.all([
        mainModel.bulkCreate(arr, {transaction: dbTx}),
        addrModel.bulkCreate(dataForAddr, {transaction: dbTx}),
        ContractUser.bulkCreate(arr, {transaction: dbTx}),
    ])
}
export async function waitParentHashDB(task: IEpochTokenTransfer, parentEpoch:number, model) : Promise<string> {
    if (!task.checkPivot) {
        return ''
    }
    if (parentEpoch === -1) {
        return '-'
    }
    do {
        const formerOne = await model.findByPk(parentEpoch);
        if (formerOne === null) {
            console.log(` current task with epoch ${task.epoch
            } says: former task not finished yet, want epoch ${parentEpoch} be finished. ${model.getTableName()}`)
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
    let parentHash = await waitParentHashDB(task, task.cursor, EpochHashTokenTransfer)
    async function buildTransfer(arr:any[], fn, dt) {
        for (let e of arr) {
            await fn(e, dt)
        }
    }
    function buildNfts(list, arr) {
        list.forEach(t=>{
            t.updatedAt = t.createdAt
            arr.push(t)
        })
    }
    async function fetchAndBuild(epoch: number) {
        const {pivotTime: dt, receipts, blockHashes, parentDbBlock, pivotHash} = await loadEpoch(epoch, cfx);
        let {t20:t20raw, t721, t1155, approvals} = decodeTransferFromReceipts(receipts, tokenTool, dt, blockHashes);
        const t20 = aggregateTransfer(t20raw)
        approvals = aggregateTransfer(approvals, true);
        const relations = []
        buildRelation(approvals, relations)
        // after all id is cached, it's almost cpu computation.
        await buildTransfer(t20, buildErc20Transfer, dt);
        await buildTransfer(t721, buildErc721Transfer, dt);
        await buildTransfer(t1155, buildErc721Transfer, dt);
        await buildTransfer(approvals, buildErc20Transfer, dt);
        const nfts = []
        buildNfts(t721, nfts)
        buildNfts(t1155, nfts)
        // build data out of transaction, reduce tx time.
        const [t20addr, t721addr, t1155addr] = [t20, t721, t1155].map(buildTransferList2address)
        return {t20, t20addr, t721, t721addr, t1155, t1155addr, nfts, approvals, relations, dt, pivotHash, parentHash: parentDbBlock?.hash}
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
        parentHash = await waitParentHashDB(task, ep - 1, EpochHashTokenTransfer)
        console.log(` local pop ${ep} end -`)
        return ep
    }
    const loader = new PreLoader(cfx, fetchAndBuild, 3, stopBeforeEpoch);
    loader.preLoadSize = 10;
    // should not higher than block/tx sync, otherwise the transaction hash may not be found.
    let maxEpochOfBlock = 0;
    async function updateMaxDbEpoch() {
        const maxE = await loadMaxBlockEpoch()
        if (typeof maxE !== 'number') {
            console.log(` FullTransaction is empty. ${new Date().toISOString()}`)
            return;
        }
        maxEpochOfBlock = maxE;
        console.log(` update max epoch of block to ${maxE} `)
    }
    await updateMaxDbEpoch()
    let firstWait = true
    async function repeat() {
        return repeat0().catch(err=>{
            console.log(` repeat error : `, err)
            setTimeout(repeat, 5_000)
        })
    }
    async function repeat0() {
        if (epoch>maxEpochOfBlock) {
            await updateMaxDbEpoch();
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
                        delay = 10_000
                        break;
                    } else if (data instanceof Error) {
                        console.log(` error at epoch ${epoch}`, data)
                        delay = 10_000;
                        break;
                    } else if (data?.parentHash && parentHash && data.parentHash !== parentHash) {
                        console.log(` before save check, parent hash not match, on hand epoch ${epoch
                        } with PH ${data.parentHash} != ${parentHash} (parent)`)
                        await  localPop(epoch - 1)
                        delay = 10_000
                        break;
                    }
                    await processData(epoch, data);
                    if (epoch % dumpPerRound === 0) {
                        console.log(` sync transfer sample log, at epoch ${epoch}`);
                        measure.dump(` ------ sync transfer metrics: `, 1, 'epoch', fetchAndBuildTag, 'save');
                    }
                    epoch ++
                } catch (e) {
                    if (e instanceof UniqueConstraintError) {
                        console.log(` UniqueConstraintError, epoch ${epoch}, ${e.message}`, e)
                        await sleep(10_000)
                        break;
                    } else if (e instanceof DatabaseError) {
                        const message = ` DatabaseError, epoch ${epoch}, ${e.message}`;
                        console.log(message, e)
                        await sleep(10_000)
                        break;
                    }
                    const failMsg = `process epoch fail at ${epoch}, task start epoch ${taskBegin}, `;
                    console.log(failMsg, e)
                    await notifyError(failMsg, e);
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
            await finishTask(taskBegin, EpochTaskTokenTransfer);
            endFn()
        }
    }
    repeat().then()
}
export async function finishTask(epoch, model) {
    await model.update({finished: true}, {where: {epoch}})
    console.log(` ---- finish task ${epoch} ---- ${model.getTableName()}`)
}
async function save(epoch:number, {t20, t20addr, t721, t721addr, t1155, t1155addr, approvals, relations, pivotHash, nfts}, taskBegin:number) {
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
                {where:{epoch:taskBegin}, transaction:dbTx}),
            saveApprovals(epoch, approvals, relations, dbTx)
        ])
    })
}
async function saveApprovals(epoch: number, approvals, relations, dbTx) {
    if (epoch < uniformApprovalEpoch) {
        return
    }
    return Promise.all([
        batchSaveApproval(TokenApproval, approvals, dbTx),
        ApprovalRelation.bulkCreate(relations, {transaction: dbTx,
                      updateOnDuplicate:["updatedAt","epoch","blockIndex","txIndex", "value"],
                  })
    ])
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
            partitionModel.destroy({where: {addressId:{[Op.in]:addrIdArr}, epoch}, transaction:dbTx}).then((cnt)=>`P:${cnt}/${addrIdArr.length}`)
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
async function setCheckPivot(task:IEpochTokenTransfer, cfx:Conflux, len:number) {
    const stateEpoch = await cfx.getEpochNumber('latest_state')
    const checkPivot = stateEpoch - task.epoch < len * 2 || FORCE_CHECK_PIVOT
    task.checkPivot = checkPivot;
}
export async function fetchTask(len:number, fromEpoch: number, cfx:Conflux, model) : Promise<IEpochTokenTransfer> {
    do {
        const [maxOne, exactOne] = await Promise.all([
            model.findOne({order:[['epoch','desc']]}),
            model.findOne({where: {epoch: fromEpoch, finished: false}}), // resume exists task
        ])
        if (exactOne) {
            await setCheckPivot(exactOne, cfx, len)
            console.log(` resume exists task ${exactOne.epoch}, cursor ${exactOne.cursor}, checkPivot ${exactOne.checkPivot}`)
            return exactOne;
        }
        if (fromEpoch === -1) {
            if (maxOne?.finished === false) {
                await setCheckPivot(maxOne, cfx, len)
                console.log(` continue unfinished task, epoch ${maxOne.epoch}, cursor ${maxOne.cursor}, checkPivot ${maxOne.checkPivot}`)
                return maxOne; // continue unfinished task.
            } else {
                fromEpoch = FirstBlockNo;
            }
        }
        let preEnd = fromEpoch;
        if (maxOne !== null) {
            preEnd = maxOne.epoch + maxOne.range
        }
        // check whether need new task.
        const stateEpoch = await joinTask(preEnd, cfx, len * 2, model)
        const checkPivot = stateEpoch - preEnd < len * 2 || FORCE_CHECK_PIVOT
        console.log(`checkPivot : ${stateEpoch - preEnd < len * 2} || ${FORCE_CHECK_PIVOT}`)
        const now = new Date();
        const newOne:IEpochTokenTransfer = {epoch: preEnd, range: len,
            cursor: preEnd - 1, checkPivot,
            finished: false, createdAt: now, updatedAt: now}
        let ok = false
        await model.create(newOne).then(()=>{
            console.log(`create task, epoch ${preEnd}, checkPivot ${checkPivot}`)
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
async function updateAllTokenTransferCount(lt = 100_000) {
    const list = await Token.findAll({
        where: {auditResult: true, transfer: {[Op.lt]: lt}},
        attributes: {exclude: ['icon']},
    })
    for (let i = 0; i < list.length; i++) {
        const token = list[i]
        process.stdout.write(`begin update ${token.name} :`)
        await updateTransferCountReal(token)
    }
    await Token.sequelize.close();
    process.exit(0)
}
let notifyError:Function
// noinspection DuplicatedCode
async function setup(cfxUrl:string, fromEpoch = '30495000', taskLen = '3000') {
    const config = await init();
    if (process.argv.includes('updateAllTokenTransferCount')) {
        await updateAllTokenTransferCount()
        await Erc20Transfer.sequelize.close()
        return;
    }
    notifyError = async (msg, err)=>{
        return dingMsg(`[${config.serverTag}] TOKEN-X-SYNC ${msg}: ${err}`, config.dingTalkToken)
    }
    console.log(`--------------------`)

    const confluxOption = cfxUrl === 'useConfigRpc' ? (config.tokenTransferRpc || config.conflux) : {url: cfxUrl}
    let cfx = await initCfxSdk(confluxOption);
    console.log(` ${process.argv[1]} \n ------- network ${cfx.networkId} --------`)

    await makeUniformApprovalEpoch()
    return runTask(cfx, parseInt(fromEpoch), parseInt(taskLen))
}
export async function joinTask(targetEpoch:number, cfx: Conflux, dist:number, model) {
    let stateEpoch: number;
    do {
        stateEpoch = await cfx.getEpochNumber('latest_state').catch(()=>{
            return 0
        });
    } while (stateEpoch === 0)
    if (stateEpoch - targetEpoch >  dist) {
        return stateEpoch;
    }
    const formerOne = await model.findOne({
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
let uniformApprovalEpoch = -1
async function makeUniformApprovalEpoch() {
    let n = await KV.getNumber(UNIFORM_APPROVAL_EPOCH, -1)
    if (n >= 0) {
        uniformApprovalEpoch = n;
        return
    }
    const [tokenTr, apprTask] = await Promise.all([
      EpochTaskTokenTransfer.findOne({order:[['epoch', 'desc']]}),
      TaskEpochApproval.findOne({order:[['epoch', 'desc']]})
    ])
    if (!apprTask) {
        // approval sync has not been started
        uniformApprovalEpoch = FirstBlockNo
        return
    }
    const gap = 60;
    let laterEpoch = apprTask.cursor + gap;
    if (tokenTr?.cursor + gap > laterEpoch) {
        laterEpoch = tokenTr.cursor + gap
    }
    await KV.saveNumber(UNIFORM_APPROVAL_EPOCH, laterEpoch, undefined)
    uniformApprovalEpoch = laterEpoch;
    console.log(` make new uniformApprovalEpoch `, uniformApprovalEpoch)
}
// noinspection DuplicatedCode
async function runTask(cfx:Conflux, fromEpoch:number = 0, len) {
    const task = await fetchTask(len, fromEpoch, cfx, EpochTaskTokenTransfer)
    console.log(` start token transfer task, [${task.epoch}, ${task.range+task.epoch}), len ${task.range
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
const FORCE_CHECK_PIVOT = Boolean(process.env.FORCE_CHECK_PIVOT)
if (module === require.main) {
    redirectLog()
    regExitHook()
    // fromEpoch:
    // -1 : use former unfinished task; exclude mode.
    // N  : use task N if it's not finished, fallback to *.
    // *  : auto create based on max task.
    const [, , cfxUrl, fromEpoch, taskLen] = process.argv
    setup(cfxUrl, fromEpoch, taskLen).then().catch(err => {
        console.log(`${process.argv[1]}\n`, err)
        process.exit(1)
    });
}
