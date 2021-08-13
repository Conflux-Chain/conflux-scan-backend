// cfx transfer contains in-correct records, caused by mis-understand of trace.action.callType like delegate call
// Delegate call doesn't has real cfx transfer but has value > 0

import {AddressCfxTransfer, CfxTransfer} from "../../model/CfxTransfer";
import {CfxBill, DummyNode} from "../watcher/DummyNode";
import {Op} from 'sequelize'
import {init} from "./FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";

let del = false
async function processOne(epoch, dmNode:DummyNode) {
    // check cfx_transfer by epoch,
    // if all records appears in cfx bill, it's ok
    // if all records miss in cfx bill, then cfx bill is in-correct, fix cfx bill, then check again.
    const trans = await CfxTransfer.findAll({
        where: {epoch}, order: [['id','asc']]
    })
    const idSet = new Set<number>();
    trans.forEach(t=>{
        idSet.add(t.fromId);
        idSet.add(t.toId);
    })
    let bills = await CfxBill.findAll({
        where: {ownerId:{[Op.in]:[...idSet], epoch}},
        order: [['epoch','asc'],['seq', 'asc']]
    })
    if (bills.length === 0) {
        bills = await dmNode.processOne(epoch, false)
        console.log(` fix epoch cfx bill ${epoch}, length ${bills.length}`)
        if (bills.length === 0) {
            console.log(` fix cfx bill fail with zero bill.`)
            process.exit(9)
            return
        }
    }
    //
    const positiveBills = bills.filter(b=>b.balance > 0)
    // match
    let bIdx = 0; let tIdx = 0
    do {
        const tr = trans[tIdx]
        const bill = positiveBills[bIdx]
        if (tr.fromId === bill.fromId && tr.toId === bill.toId && tr.value === bill.diffDrip) {
            // it's good one.
            bIdx++; tIdx++;
        } else if (!del){
            console.log(`will del main ${tr.id}, both side : ${tr.fromId}, ${tr.toId} epoch ${epoch}, value ${tr.value}`)
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
    } while (bIdx < positiveBills.length && tIdx < trans.length)
    // should reach last positiveBills and last trans
    if (bIdx !== positiveBills.length || tIdx !== trans.length) {
        console.log(`not reach end, bill ${bIdx}/${positiveBills.length}, trans ${tIdx}/${trans.length}`)
        process.exit(10)
    }
}

if (require.main === module) {
    const args = process.argv.slice(2)
    const from = Number(args[0])
    init().then(cfg=>{
        const cfx = new Conflux(cfg.conflux)
        patchHttpProvider(cfx, cfg.conflux)
        const dmNode = new DummyNode(cfx)
        return processOne(from, dmNode)
    })
}