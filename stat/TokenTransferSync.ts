import {
    getTokenTool,
    IEpochTask,
} from "./service/UniqueAddressStat";
import {Model,DataTypes, Sequelize} from "sequelize";
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
            sequelize: seq, tableName: 'epoch_token_transfer',
        })
    }
}

function decodeTransferFromReceipts(receipts2d:TransactionReceipt[][],tokenTool: TokenTool, dt:Date) {
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
            let txLogIndex = -1
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
const measure = new Measure()
const dumpPerRound = parseInt(process.env.ROUND || '1000')
async function run(cfx:Conflux, fromEpoch:number, stopBeforeEpoch:number, endFn:()=>void, taskBegin:number) {
    const {tokenTool} = getTokenTool(cfx)
    async function buildTransfer(arr:any[], fn, dt) {
        for (let e of arr) {
            await fn(e, dt)
        }
    }
    async function fetchAndBuild(epoch: number) {
        const [receipts, block] = await Promise.all([
            cfx.getEpochReceipts(epoch),
            cfx.getBlockByEpochNumber(epoch),
        ])
        const dt = new Date(block.timestamp * 1000)
        const {t20:t20raw, t721, t1155} = decodeTransferFromReceipts(receipts, tokenTool, dt);
        const t20 = aggregateTransfer(t20raw)
        // after all id is cached, it's almost cpu computation.
        await buildTransfer(t20, buildErc20Transfer, dt);
        await buildTransfer(t721, buildErc721Transfer, dt);
        await buildTransfer(t1155, buildErc721Transfer, dt);
        // build data out of transaction, reduce tx time.
        const [t20addr, t721addr, t1155addr] = [t20, t721, t1155].map(buildTransferList2address)
        return {t20, t20addr, t721, t721addr, t1155, t1155addr, dt}
    }
    async function processData(epoch, promiseData) {
        let fetchAndBuildTag = 'fetchAndBuild';
        const finalData = await measure.call(fetchAndBuildTag, ()=>promiseData);
        await measure.call('save', ()=>save(epoch, finalData as any, taskBegin))
        if (epoch % dumpPerRound === 0) {
            console.log(` sync transfer , epoch ${epoch}`)
            measure.dump(` ------ sync transfer metrics: `, 1, fetchAndBuildTag, 'save');
        }
    }
    const loader = new PreLoader(cfx, fetchAndBuild, 5, stopBeforeEpoch);
    loader.preLoadSize = 10;
    let epoch = fromEpoch;
    let firstWait = true
    async function repeat() {
        const {action, data} = loader.get(epoch)
        let delay = 0
        switch (action) {
            case "ok":
                try {
                    await processData(epoch, data)
                    epoch ++
                } catch (e) {
                    console.log(`process epoch fail at ${epoch}`, e)
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
async function save(epoch:number, {t20, t20addr, t721, t721addr, t1155, t1155addr}, taskBegin:number) {
    return KV.sequelize.transaction(dbTx=>{
        return Promise.all([
            batchSaveTransfer(Erc20Transfer, AddressErc20Transfer, t20, t20addr, dbTx),
            batchSaveTransfer(Erc721Transfer, AddressErc721Transfer, t721, t721addr, dbTx),
            batchSaveTransfer(Erc1155Transfer, AddressErc1155Transfer, t1155, t1155addr, dbTx),
            EpochTaskTokenTransfer.update(
                {cursor: epoch},
                {where:{epoch:taskBegin}, transaction:dbTx})
                // .then(res=>{
                //     console.log(` update cursor, epoch ${epoch} result `, res)
                // })
        ])
    })
}
async function fetchTask(len:number, fromEpoch = 0) : Promise<IEpochTokenTransfer> {
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
        const now = new Date();
        const newOne:IEpochTokenTransfer = {epoch: preEnd, range: len,
            cursor: preEnd - 1,
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
    // await RedisWrap.connect(config.redis)
    console.log(`--------------------`)

    const cfxOp = cfxUrl ? {url: cfxUrl} : config.conflux
    let cfx = new Conflux(config.conflux)
    patchHttpProvider(cfx, cfxOp)
    const st = await cfx.getStatus()
    console.log(` ${process.argv[1]} \n network ${st.networkId}`)
    return runTask(cfx, parseInt(fromEpoch), parseInt(taskLen))
}
// noinspection DuplicatedCode
async function runTask(cfx:Conflux, fromEpoch:number = 0, len) {
    const task = await fetchTask(len, fromEpoch)
    console.log(` start token transfer task, [${task.epoch}, ${task.range+task.epoch}), len ${task.range
    }, cursor/first epoch ${task.cursor + 1}`)
    await new Promise(r=>{
        run(cfx, task.cursor+1, task.epoch + task.range, ()=>{
            r(0)
        }, task.epoch)
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