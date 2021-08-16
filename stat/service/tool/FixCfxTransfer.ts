// cfx transfer contains in-correct records, caused by mis-understand of trace.action.callType like delegate call
// Delegate call doesn't has real cfx transfer but has value > 0

import {AddressCfxTransfer, CfxTransfer} from "../../model/CfxTransfer";
import {CfxBill, DummyNode} from "../watcher/DummyNode";
import {Op, col} from 'sequelize'
import {init} from "./FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";

let del = false
function mySort(a, b) {
    return a.fromId > b.fromId ? 1 : (
        a.toId > b.toId ? 1 : (
            a.value > b.value ? 1 : (
                (a.id > b.id || a.seq > b.seq) ? 1 : 0
            )
        )
    )
}
async function processOne(epoch, dmNode:DummyNode) {
    // check cfx_transfer by epoch,
    // if all records appears in cfx bill, it's ok
    // if all records miss in cfx bill, then cfx bill is in-correct, fix cfx bill, then check again.
    const trans = await CfxTransfer.findAll({
        where: {epoch, fromId: {[Op.ne]:col('toId')}}, order: [['id','asc']]
    })
    if (trans.length === 0) {
        return
    }
    const idSet = new Set<number>();
    trans.forEach(t=>{
        idSet.add(t.fromId);
        idSet.add(t.toId);
    })
    let logMsg = []
    let bills = await CfxBill.findAll({
        where: {ownerId:{[Op.in]:[...idSet]}, epoch, },
        order: [['epoch','asc'],['seq', 'asc']],
        logging: (...args) => {logMsg = args}
    })
    //
    const positiveBills = bills.filter(b=>b.diffDrip > 0 && (b.type === 'call'
        || b.type === 'transfer'
        || b.type === 'in_trans'
    ))
    if (trans.length === positiveBills.length) {
        return
    }
    positiveBills.sort(mySort);
    trans.sort(mySort)
    // match
    let bIdx = 0; let tIdx = 0
    let keep = 0
    do {
        const tr = trans[tIdx]
        const bill = positiveBills[bIdx] || {fromId:-1, toId: -1, diffDrip: -1}
        if (tr.fromId === bill.fromId && tr.toId === bill.toId && tr.value === bill.diffDrip) {
            // it's good one.
            bIdx++; tIdx++;
            keep += 1
            continue
        }
        console.log(`not match tr vs bill: from ${tr.fromId}/${bill.fromId} to ${tr.toId}/${bill.toId} value ${tr.value}/${bill.diffDrip}`)
        if (!del){
            console.log(`will del main ${tr.id}, both side : from ${tr.fromId} to ${tr.toId} epoch ${epoch}, value ${tr.value}`)
            tIdx ++
        } else {
            console.log(`real del main ${tr.id}, both side : ${tr.fromId}, ${tr.toId} epoch ${epoch}, value ${tr.value}`)
            tIdx ++
            // delete cfx_transfer
            await Promise.all([
                CfxTransfer.destroy({where: {id: tr.id}}),
                AddressCfxTransfer.destroy({where:{
                    addressId: {[Op.in]:[tr.fromId, tr.toId]},
                        epoch, fromId: tr.fromId, toId: tr.toId, value: tr.value
                    }, limit: 2})
            ])
        }
    } while (tIdx < trans.length)
    // should reach last positiveBills and last trans
    if (bIdx !== positiveBills.length || tIdx !== trans.length || keep !== positiveBills.length) {
        console.log(`cfx bill query ${logMsg.join(';')}`)
        console.log(`will keep ${keep}, not reach end, bill ${bIdx}/${positiveBills.length}, trans ${tIdx}/${trans.length}`)
        process.exit(10)
    } else {
        console.log(`check ok, keep ${keep} epoch ${epoch}`)
    }
}

async function loop(from, dmNode:DummyNode) {
    const stop = await CfxTransfer.max('epoch')
    while (from <= stop) {
        await processOne(from++, dmNode)
    }
    console.log(`${new Date().toISOString()}, done, stop at ${stop}`)
}
if (require.main === module) {
    const args = process.argv.slice(2)
    const from = Number(args[0])
    init().then(cfg=>{
        const cfx = new Conflux(cfg.conflux)
        patchHttpProvider(cfx, cfg.conflux)
        const dmNode = new DummyNode(cfx)
        if (args.includes('loop')) {
            return loop(from, dmNode)
        } else {
            return processOne(from, dmNode)
        }
    }).then(()=>{
        return CfxBill.sequelize.close()
    })
}