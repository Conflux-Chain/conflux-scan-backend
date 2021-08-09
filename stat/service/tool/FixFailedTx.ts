import {AddressTransactionIndex, FailedTx, FullTransaction} from "../../model/FullBlock";
import {Op} from 'sequelize'
import {FullBlockService} from "../FullBlockService";
import {init} from "./FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {Epoch} from "../../model/Epoch";
import {patchHttpProvider} from "../common/utils";
const pLimit = require('p-limit');

const limitR = pLimit(100);
async function listFailedTx(epoch, count) {
    return limitR(()=>FullTransaction.findAll({
        where:{epoch:{[Op.gte]:epoch}},
        limit: count, order:[['epoch', 'asc'],['blockPosition','asc'],['txPosition', 'asc']]
    }))
}
function remove_partial(arr:FullTransaction[]) : FullTransaction[] {
    if (arr.length === 0) {
        return arr;
    }
    const last = arr[arr.length-1]
    const ret = arr.filter(t=>t.epoch < last.epoch)
    if (ret.length === 0) {
        console.log(`\n after filter got zero elements: epoch ${last.epoch}, original count ${arr.length}`)
    }
    return ret;
}
async function patch(list:FullTransaction[]) {
    const set = new Set(list.map(t=>t.epoch))
    const epochs = [...set]
    const receiptsAllEpochMap = new Map()
    await Promise.all(epochs.map(async ep=>{
        // @ts-ignore
        return limitR(()=>cfx.getEpochReceipts(ep)).then(rc=>receiptsAllEpochMap.set(ep, rc))
    }))
    for (const t of list) {
        const receipts = receiptsAllEpochMap.get(t.epoch)
        const receipt = receipts[t.blockPosition][t.txPosition]
        await Promise.all([
            FullTransaction.update({gas: receipt.gasFee},{
                where: {epoch: t.epoch, blockPosition: t.blockPosition, txPosition: t.txPosition},
                limit: 1,
                logging: t.epoch === 477 ? console.log : false
            }).then(([cnt])=>{
                if (t.epoch === 477) {
                    console.log(`update affected ${cnt}\n`)
                }
            }),
            AddressTransactionIndex.update({gas: receipt.gasFee}, {
                where: {addressId: t.fromId, epoch: t.epoch, blockPosition: t.blockPosition, txPosition: t.txPosition},
                limit: 1,
            }),
            AddressTransactionIndex.update({gas: receipt.gasFee}, {
                where: {addressId: t.toId, epoch: t.epoch, blockPosition: t.blockPosition, txPosition: t.txPosition},
                limit: 1,
            })
        ])
    }
    return list.length
    // for (const tx of list) {
    //     // tasks.push(limitR(()=>FullBlockService.syncFailedTx0(tx.epoch, tx.blockPosition, tx.txPosition, tx.hash, cfx).then(info=>{
    //     //     if (info) return FailedTx.create(info)
    //     // })))
    // }
    // const ret = await Promise.all(tasks).catch(err=>{
    //     console.log(`\n error:`, err)
    //     return -1
    // })
    // if (ret === -1) {
    //     return -1
    // }
    // return tasks.length

}
async function iterAllTx(from) {
    const stop = await FullTransaction.max('epoch')
    const batch = 3000
    while(from <= stop) {
        const list_all = await listFailedTx(from, batch)
        const list = remove_partial(list_all)
        const cnt = await patch(list)
        if (cnt === 0) {
            break;
        }
        const lastEpoch = list[list.length - 1]?.epoch
        process.stdout.write(`\r\u001b[2K fixed count ${cnt.toString().padStart(3,' ')}, to epoch ${lastEpoch}, will stop at ${stop}  $`)
        from = lastEpoch + 1
    }
    console.log(`\n Done ${from}`)
    return FullTransaction.sequelize.close()
}
const args = process.argv.slice(2)
let from = args[0]
let cfx:Conflux
init().then((ccc)=>{
    cfx = new Conflux(ccc.conflux)
    patchHttpProvider(cfx, ccc.conflux)
    return iterAllTx(Number(from))
})