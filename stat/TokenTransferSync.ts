import {EpochTask, fetchTask, fetchTaskByType, getTokenTool, registerTaskTable} from "./service/UniqueAddressStat";
import {Sequelize} from "sequelize";
import {init} from "./service/tool/FixDailyTokenStat";
import {RedisWrap} from "./service/RedisWrap";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "./service/common/utils";
import {Measure} from "./service/common/Measure";
import {TransactionReceipt} from "js-conflux-sdk/types/rpc";
import {TokenTool} from "./service/tool/TokenTool";

export class EpochTaskTokenTransfer extends EpochTask{
    static register(seq: Sequelize) {
        registerTaskTable(seq, EpochTaskTokenTransfer, 'epoch_task_token_transfer')
    }
}

async function decodeTransferFromReceipts(receipts2d:TransactionReceipt[][],tokenTool: TokenTool) {
    const result = {t20:[],t721:[],t1155:[]}
    let blockIdx = -1;
    for (let receiptsInBlock of receipts2d) {
        blockIdx ++
        for (let txReceipt of receiptsInBlock) {
            for (let log of txReceipt.logs) {
                if (log.topics.length < 3) {
                    continue;
                }
                const {topics: [, t1, t2, ]} = log
                if (t1 === undefined || t2 === undefined) {
                    continue
                }
                let transfer;
                if ((transfer = tokenTool.decodeERC20TransferPlus(log))) {
                    transfer['blockIdx'] = blockIdx;
                    result.t20.push(transfer)
                } else if ((transfer = tokenTool.decodeERC721Transfer(log))) {
                    transfer['blockIdx'] = blockIdx;
                    result.t721.push(transfer)
                } else if ((transfer = tokenTool.decodeERC1155TransferArrayPlus(log))) {
                    transfer.forEach(e=>{
                        e['blockIdx'] = blockIdx;
                        result.t1155.push(e)
                    })
                }
            }
        }
    }
    return result;
}
const measure = new Measure()
async function run(cfx:Conflux, fromEpoch:number, stopBeforeEpoch:number, endFn:()=>void) {
    const {tokenTool, topics} = getTokenTool(cfx)
    async function process(epoch: number) {
        const receipts = await cfx.getEpochReceipts(epoch);
        const transfers = await decodeTransferFromReceipts(receipts, tokenTool);
    }
}
// noinspection DuplicatedCode
async function setup(cfxUrl:string, fromEpoch = '30495305', taskLen = '3000') {
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
// noinspection DuplicatedCode
async function runTask(cfx:Conflux, fromEpoch:number = 0, len) {
    const task = await fetchTaskByType(EpochTaskTokenTransfer, len, fromEpoch)
    console.log(` start task, [${task.epoch}, ${task.range+task.epoch}), len ${task.range}`)
    await new Promise(r=>{
        run(cfx, task.epoch, task.epoch + task.range, ()=>{
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