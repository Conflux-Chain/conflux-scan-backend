import {
    getTokenTool,
    IEpochTask,
} from "./service/UniqueAddressStat";
import {Model,DataTypes, Sequelize, Op} from "sequelize";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "./service/common/utils";
import {Measure} from "./service/common/Measure";
import {TransactionReceipt} from "js-conflux-sdk/types/rpc";
import {TokenTool} from "./service/tool/TokenTool";
import {
    AddressErc20Transfer,
    aggregateTransfer,
    buildErc20Transfer, buildTransferList2address,
    Erc20Transfer,
} from "./model/Erc20Transfer";
import {AddressErc721Transfer, buildErc721Transfer, Erc721Transfer} from "./model/Erc721Transfer";
import {AddressErc1155Transfer, Erc1155Transfer} from "./model/Erc1155Transfer";
import {KV} from "./model/KV";
import {PreLoader} from "./service/common/PreLoader";
import {sleep} from "./service/tool/ProcessTool";

export interface IEpochTokenTransfer extends IEpochTask {
    cursor:number
    pivotHash: string
    checkPivot?: boolean
}
export class EpochTaskTokenTransfer extends Model<IEpochTokenTransfer> implements IEpochTokenTransfer{
    epoch: number
    range: number
    createdAt: Date
    updatedAt: Date
    finished: boolean

    cursor: number;
    pivotHash: string
    static register(seq: Sequelize) {
        EpochTaskTokenTransfer.init({
            epoch: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true},
            cursor: {type: DataTypes.BIGINT, allowNull: false},
            range: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
            finished: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            pivotHash: {type: DataTypes.CHAR(66), allowNull: false},
        },{
            sequelize: seq, tableName: 'epoch_token_transfer',
        })
    }
}

function decodeTransferFromReceipts(receipts2d:TransactionReceipt[][],tokenTool: TokenTool,
                                    dt:Date, blockHashes:string[]) {
    const result = {t20:[],t721:[],t1155:[]}
    function push(arr:any[], transfer, blockIdx, tx:TransactionReceipt, txLogIndex) {
        transfer['epoch'] = tx.epochNumber;
        transfer['transactionIndex'] = tx.index;
        transfer['transactionLogIndex'] = txLogIndex;
        transfer['blockIndex'] = blockIdx;
        transfer['createdAt'] = dt;
        arr.push(transfer)
    }
    let blockIdx = -1;
    for (let receiptsInBlock of receipts2d) {
        blockIdx ++
        for (let txReceipt of receiptsInBlock) {
            if (txReceipt.outcomeStatus !== 0) {
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
                    push(result.t20, transfer, blockIdx, txReceipt, txLogIndex)
                } else if ((transfer = tokenTool.decodeERC721Transfer(log, false))) {
                    push(result.t721, transfer, blockIdx, txReceipt, txLogIndex);
                } else if ((transfer = tokenTool.decodeERC1155TransferArrayPlus(log))) {
                    transfer.forEach(e=>{
                        push(result.t1155, e, blockIdx, txReceipt, txLogIndex);
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
    ])
}
async function waitParentHashDB(task: IEpochTokenTransfer, parentEpoch:number) : Promise<string> {
    if (!task.checkPivot) {
        return ''
    }
    do {
        const formerOne = await EpochTaskTokenTransfer.findOne({
            where: {epoch: {[Op.lt]: task.epoch, cursor: parentEpoch}},
            order: [['epoch', 'desc']]
        })
        if (formerOne === null) {
            console.log(` former task not finished yet, want cursor ${parentEpoch} be finished.`)
            await sleep(5_000)
            continue
        }
        return formerOne.pivotHash;
    } while (true)
}
const measure = new Measure()
const dumpPerRound = parseInt(process.env.ROUND || '1000')
async function run(cfx:Conflux, task:IEpochTokenTransfer, endFn:()=>void) {
    const fromEpoch = task.cursor+1;
    const stopBeforeEpoch = task.epoch + task.range
    const taskBegin = task.epoch;
    const {tokenTool} = getTokenTool(cfx)
    let parentHash = await waitParentHashDB(task, task.cursor)
    async function buildTransfer(arr:any[], fn, dt) {
        for (let e of arr) {
            await fn(e, dt)
        }
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
            throw new Error(` block hash mismatch at epoch ${epoch
            }, from pivot block ${pivotHash}, from block hashes ${blockHashes[blockHashes.length - 1]}`)
        }
        if (parentHash && parentHash !== block.parentHash && epoch > 0) {
            throw new Error(` check parent hash fail, want ${parentHash}, actual ${block.parentHash}`)
        }
        const dt = new Date(block.timestamp * 1000);
        const {t20:t20raw, t721, t1155} = decodeTransferFromReceipts(receipts, tokenTool, dt, blockHashes);
        const t20 = aggregateTransfer(t20raw)
        // after all id is cached, it's almost cpu computation.
        await buildTransfer(t20, buildErc20Transfer, dt);
        await buildTransfer(t721, buildErc721Transfer, dt);
        await buildTransfer(t1155, buildErc721Transfer, dt);
        // build data out of transaction, reduce tx time.
        const [t20addr, t721addr, t1155addr] = [t20, t721, t1155].map(buildTransferList2address)
        return {t20, t20addr, t721, t721addr, t1155, t1155addr, dt, pivotHash}
    }
    const fetchAndBuildTag = 'fetchAndBuild';
    async function processData(epoch, promiseData) {
        const finalData = await measure.call(fetchAndBuildTag, ()=>promiseData);
        await measure.call('save', ()=>save(epoch, finalData as any, taskBegin))
        if (parentHash) { // checking mode.
            parentHash = finalData['pivotHash'];
        }
        return finalData;
    }
    const loader = new PreLoader(cfx, fetchAndBuild, 500, stopBeforeEpoch);
    loader.preLoadSize = 10;
    let epoch = fromEpoch;
    let firstWait = true
    async function repeat() {
        const {action, data} = loader.get(epoch)
        let delay = 0
        switch (action) {
            case "ok":
                try {
                    await measure.call('epoch', ()=>processData(epoch, data))
                    if (epoch % dumpPerRound === 0) {
                        console.log(` sync transfer , epoch ${epoch}`)
                        measure.dump(` ------ sync transfer metrics: `, 1, 'epoch', fetchAndBuildTag, 'save');
                    }
                    epoch ++
                } catch (e) {
                    console.log(`process epoch fail at ${epoch}, task start epoch ${taskBegin}`, e)
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
    console.log(` finish task ${epoch}`)
}
async function save(epoch:number, {t20, t20addr, t721, t721addr, t1155, t1155addr, pivotHash}, taskBegin:number) {
    return KV.sequelize.transaction(dbTx=>{
        return Promise.all([
            batchSaveTransfer(Erc20Transfer, AddressErc20Transfer, t20, t20addr, dbTx),
            batchSaveTransfer(Erc721Transfer, AddressErc721Transfer, t721, t721addr, dbTx),
            batchSaveTransfer(Erc1155Transfer, AddressErc1155Transfer, t1155, t1155addr, dbTx),
            EpochTaskTokenTransfer.update(
                {cursor: epoch, pivotHash},
                {where:{epoch:taskBegin}, transaction:dbTx})
                // .then(res=>{
                //     console.log(` update cursor, epoch ${epoch} result `, res)
                // })
        ])
    })
}
async function fetchTask(len:number, fromEpoch: number, cfx:Conflux ) : Promise<IEpochTokenTransfer> {
    do {
        const [maxOne, exactOne] = await Promise.all([
            EpochTaskTokenTransfer.findOne({order:[['epoch','desc']]}),
            EpochTaskTokenTransfer.findOne({where: {epoch: fromEpoch, finished: false}}), // resume exists task
        ])
        if (exactOne) {
            console.log(` resume exists task ${fromEpoch}`)
            return exactOne;
        }
        let preEnd = fromEpoch;
        if (maxOne !== null) {
            preEnd = maxOne.epoch + maxOne.range
        }
        // check whether need new task.
        const stateEpoch = await joinTask(preEnd, cfx, len * 2)
        const checkPivot = stateEpoch - preEnd < len * 2
        const now = new Date();
        const newOne:IEpochTokenTransfer = {epoch: preEnd, range: len,
            cursor: preEnd - 1, checkPivot,
            finished: false, createdAt: now, updatedAt: now, pivotHash: ''}
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
    // await RedisWrap.connect(config.redis)
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
        where: {finished: false, epoch:{[Op.lt]:targetEpoch}},
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
if (module === require.main) {
    const [, , cfxUrl, fromEpoch, taskLen] = process.argv
    setup(cfxUrl, fromEpoch, taskLen).then().catch(err => {
        console.log(`${process.argv[1]}\n`, err)
        process.exit(1)
    })
}