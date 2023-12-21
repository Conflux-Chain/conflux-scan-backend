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
    ModelStatic,
    DatabaseError
} from "sequelize";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {initCfxSdk} from "./service/common/utils";
import {Measure} from "./service/common/Measure";
import {TransactionReceipt} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {TokenTool} from "./service/tool/TokenTool";
import {
    AddressErc20Transfer,
    aggregateTransfer,
    buildErc20Transfer, buildTransferList2address, ContractUser,
    Erc20Transfer, IErc20Transfer, T_ERC20_TRANSFER,
} from "./model/Erc20Transfer";
import {AddressErc721Transfer, buildErc721Transfer, Erc721Transfer} from "./model/Erc721Transfer";
import {AddressErc1155Transfer, Erc1155Transfer} from "./model/Erc1155Transfer";
import {KV} from "./model/KV";
import {CheckPivotHashError, PreLoader} from "./service/common/PreLoader";
import {regExitHook, sleep} from "./service/tool/ProcessTool";
import {NftMint, Token} from "./model/Token";
import {PruneNotifier} from "./service/prune/PruneNotifier";
import {PruneType} from "./model/PruneInfo";
import {RedisWrap} from "./service/RedisWrap";
import {FullBlock, FullTransaction} from "./model/FullBlock";
import {updateTransferCountReal} from "./StreamSync";
import {dingMsg} from "./monitor/Monitor";
import {EpochHashTokenTransfer, fetchTask, finishTask, joinTask, waitParentHashDB} from "./TokenTransferSync";

function decodeFromReceipts(receipts2d:TransactionReceipt[][],tokenTool: TokenTool,
                                    dt:Date, blockHashes:string[], handler:SyncHandler) {
    const result = handler.prepareData();
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
                let {key, parsed} = handler.logParser(log, dt)
                if (parsed) {
                    let arr = result[key]
                    if (!arr) {
                        arr = []
                        result[key] = arr;
                    }
                    push(arr, parsed, blockIdx, txReceipt, txLogIndex, txPos);
                }
            }
        }
    }
    return result;
}

export interface ITaskCursor extends IEpochTask {
    cursor:number
    checkPivot?: boolean
}
export class TaskTemplate extends Model<ITaskCursor> implements ITaskCursor {
    createdAt: Date;
    cursor: number;
    epoch: number;
    finished: boolean;
    range: number;
    updatedAt: Date;
    static registerTemplate(clz, seq: Sequelize, tableName:string) {
        clz.init({
            epoch: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true},
            cursor: {type: DataTypes.BIGINT, allowNull: false},
            range: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
            finished: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
        },{
            sequelize: seq, tableName: tableName,
        })
    }
}
const measure = new Measure()
const dumpPerRound = parseInt(process.env.ROUND || '1000')
async function run(cfx:Conflux, task:ITaskCursor, taskClz, endFn:()=>void,
                   handler:SyncHandler
) {
    const fromEpoch = task.cursor+1;
    const stopBeforeEpoch = task.epoch + task.range
    const taskBegin = task.epoch;
    const {tokenTool} = getTokenTool(cfx)
    // parentHash, also indicates whether checking parent hash.
    let parentHash = await waitParentHashDB(task, task.cursor, EpochHashTokenTransfer) // reuse token transfer's epoch hash
    async function fetchAndBuild(epoch: number) {
        const [receipts, blockHashes, block] = await Promise.all([
            cfx.getEpochReceipts(epoch).then(res=>{
                if (res === null && epoch === 0) {
                    res = []
                }
                return res as TransactionReceipt[][];
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
        let parsedResult = decodeFromReceipts(receipts, tokenTool, dt, blockHashes, handler);
        let postProcessedResult = await handler.postProcess(parsedResult, dt, epoch);
        return {...postProcessedResult, dt, pivotHash, parentHash: block.parentHash}
    }
    const fetchAndBuildTag = 'fetchAndBuild';
    async function processData(epoch, finalData) {
        try {
            await measure.call('save', () => handler.save(epoch, finalData as any, taskBegin))
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
        await pop(ep, taskBegin, (typeof task), handler)
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
        if (!handler.needCheckMaxEpoch()) {
            maxEpochOfBlock = await cfx.getEpochNumber()
            console.log(`use on chain epoch number ${maxEpochOfBlock}`)
            return;
        }
        const maxE = await FullBlock.max('epoch')
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
                    } else if (parentHash && data.parentHash !== parentHash) {
                        console.log(` before save check, parent hash not match, on hand epoch ${epoch
                        } with PH ${data.parentHash} != ${parentHash} (parent)`)
                        await  localPop(epoch - 1)
                        delay = 10_000
                        break;
                    } else if (data instanceof Error) {
                        console.log(` error at epoch ${epoch}`, data)
                        delay = 10_000;
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
            await finishTask(taskBegin, taskClz);
            endFn()
        }
    }
    repeat().then()
}
export interface SyncHandler {
    init:(any)=>Promise<any>;
    prepareData:()=>any;
    logParser:(log, dt:Date)=>{key, parsed},
    postProcess:(parsedResult, dt:Date, epoch)=>Promise<any>,
    save:(epoch:number, {pivotHash}, taskBegin:number)=>Promise<void>,
    popAction: (epoch, dbTx) => Promise<void>
    needCheckMaxEpoch:()=>boolean
}
async function pop(epoch:number, taskBegin: number, taskClz, handler:SyncHandler) {
    async function popTaskCursor(dbTx: Transaction) {
        // cursor could less than the start epoch of this taskClz. doesn't matter.
        // there should be only one taskClz under execution.
        return taskClz.update({cursor: epoch - 1},
            {where: {epoch: taskBegin}, limit: 1, transaction:dbTx}
            )
    }
    return taskClz.sequelize.transaction(dbTx=>{
        return Promise.all([
            handler.popAction(epoch, dbTx).then(res=>`approvals ${res}`),
            popTaskCursor(dbTx).then((cnt)=>`CURSOR ${cnt}`),
        ])
    }).then(res=>{
        console.log(` pop done. epoch ${epoch}, ${JSON.stringify(res)}`)
        return res;
    })
}


let notifyError:Function
// noinspection DuplicatedCode
export async function startSyncEvent(cfxUrl:string,
                     taskClz,//:(typeof ITaskCursor),
                     handler:SyncHandler,
                     fromEpoch = '30495000', taskLen = '3000') {
    const config = await init();
    notifyError = async (msg, err)=>{
        return dingMsg(`[${config.serverTag}] Approval-SYNC ${msg}: ${err}`, config.dingTalkToken)
    }
    console.log(`--------------------`)

    const confluxOption = cfxUrl === 'useConfigRpc' ? (config.tokenTransferRpc || config.conflux) : {url: cfxUrl}
    let cfx = await initCfxSdk(confluxOption);

    await handler.init({cfx})
    console.log(` ${process.argv[1]} \n ------- network ${cfx.networkId} ${confluxOption.url} --------`)
    return runTask(cfx, taskClz, handler, parseInt(fromEpoch), parseInt(taskLen))
}
// noinspection DuplicatedCode
async function runTask(cfx:Conflux, taskClz,
                       handler:SyncHandler,
                       fromEpoch:number = 0, len) {
    const task = await fetchTask(len, fromEpoch, cfx, taskClz)
    console.log(` start task, [${task.epoch}, ${task.range+task.epoch}), len ${task.range
    }, cursor/first epoch ${task.cursor + 1}`)
    if (fromEpoch === -1) {
        // -1 means 'continue unfinished task',
        // switch to normal(support multiple) after the first task is picked up.
        fromEpoch = 1
    }
    await new Promise(r=>{
        run(cfx, task, taskClz,()=>{
            r(0)
        }, handler)
    })
    if (len === 0) {
        console.log(`length parameter is zero, quit.`)
        process.exit(0)
    } else {
        setTimeout(() => runTask(cfx, taskClz, handler, fromEpoch, len), 0)
    }
}
if (module === require.main) {
    // redirectLog()
    // regExitHook()
    // cfxUrl: useConfigRpc
    // fromEpoch:
    // -1 : use former unfinished task; exclude mode.
    // N  : use task N if it's not finished, fallback to *.
    // *  : auto create based on max task.
    const [, , cfxUrl, fromEpoch, taskLen] = process.argv
    // setup(cfxUrl, fromEpoch, taskLen).then().catch(err => {
    //     console.log(`${process.argv[1]}\n`, err)
    //     process.exit(1)
    // });
}
