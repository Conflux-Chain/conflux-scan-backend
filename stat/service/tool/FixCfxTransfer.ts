// cfx transfer contains in-correct records, caused by mis-understand of trace.action.callType like delegate call
// Delegate call doesn't has real cfx transfer but has value > 0

import {AddressCfxTransfer, BakCfxTransfer, CfxTransfer} from "../../model/CfxTransfer";
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
    let transferLogs = []
    let trans = await CfxTransfer.findAll({
        where: {epoch, fromId: {[Op.ne]:col('toId')}}, order: [['id','asc']],
        raw: true, logging: (...args) => {transferLogs = args}
    })
    if (trans.length === 0) {
        process.stdout.write(`  \r\u001b[2K  empty transfer at epoch ${epoch}   `)
        return
    }
    const idSet = new Set<number>();
    trans.forEach(t=>{
        idSet.add(t.fromId);
        idSet.add(t.toId);
    })
    let logMsg = []
    let bills = await CfxBill.findAll({
        where: {ownerId:{[Op.in]:[...idSet]}, epoch, diffDrip: {[Op.gt]: 0}, type: {[Op.notIn]:['reward']}},
        order: [['epoch','asc'],['seq', 'asc']],
        logging: (...args) => {logMsg = args}
    })
    // full cfx transfer records are position ones. Bills contain both side records, filter positive ones.
    const positiveBills = bills.filter(b=>b.diffDrip > 0 && (b.type === 'call'
        || b.type === 'transfer'
        || b.type === 'in_trans'
        || b.type === 'create'
    ))
    if (trans.length === positiveBills.length) {
        process.stdout.write(`  \r\u001b[2K  length matches at epoch ${epoch}   `)
        return
    }
    // use map
    const billMap = new Map<string, CfxBill>()
    positiveBills.forEach(b=>{
        billMap.set([b.fromId,b.toId,b.diffDrip].join('-'), b)
    })
    if (billMap.size === positiveBills.length) {
        // all bill is unique.
        const matchedTrans = []
        const missedTrans = []
        trans.forEach(t=>{
            const key = [t.fromId, t.toId, t.value].join('-')
            if (billMap.has(key)) {
                matchedTrans.push(t)
            } else {
                missedTrans.push(t)
            }
        })
        if (matchedTrans.length === positiveBills.length) {
            // good
            await BakCfxTransfer.bulkCreate(missedTrans)
            if (del) {
                // todo
            }
            return
        } else {
            console.log(`matched more.`)
            console.log(`cfx bill query ${logMsg.join(';  ')}`)
            console.log(`transfer query query ${transferLogs.join(';  ')}`)
            process.exit(9)
        }
    } else {
        console.log(`map is not unique,`)
        // try to find out the bad ones
        const wantBadCount = trans.length - positiveBills.length
        const badOnes = []
        trans.forEach(t=>{
            const key = [t.fromId, t.toId, t.value].join('-')
            if (!billMap.has(key)) {
                badOnes.push(t)
            }
        })
        if (badOnes.length === wantBadCount) {
            await BakCfxTransfer.bulkCreate(badOnes)
            return
        }
        //
        positiveBills.sort(mySort);
        trans.sort(mySort)
    }
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
            await BakCfxTransfer.create(tr)
        } else {
            console.log(`real del main ${tr.id}, both side : ${tr.fromId}, ${tr.toId} epoch ${epoch}, value ${tr.value}`)
            tIdx ++
            // delete cfx_transfer
            await Promise.all([
                BakCfxTransfer.create(tr),
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
        console.log(`transfer query query ${transferLogs.join(';')}`)
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

async function doDeletion(epoch=0) {
    // next will be greater than epoch paramter.
    do {
        const min = await BakCfxTransfer.min('epoch', {
            where: {epoch: {[Op.gt]: epoch}}
        })
        if (!min) {
            break;
        }
        const list = await BakCfxTransfer.findAll({
            where: {epoch: min}, raw: true,
        })
        for (const r of list) {
            const delResult = await CfxTransfer.destroy({
                where: {id: r.id}
            })
            if (!delResult) {
                console.log(`\n deletion fail, result ${delResult}`)
                process.exit(8)
            }
            process.stdout.write(`  \r\u001b[2K  delete id ${r.id}, epoch ${r.epoch}, result ${delResult}  `)
            const associateResult = await AddressCfxTransfer.destroy({
                where: {addressId: {[Op.in]:[r.fromId, r.toId]}, epoch: r.epoch, fromId: r.fromId, toId: r.toId,
                    createdAt: r.createdAt, value: r.value, txHashId: r.txHashId
                }
            })
            const wantCnt = r.fromId === r.toId ? 1 : 2
            if (associateResult === wantCnt * 2 || associateResult === 0) {
                // it's ok.
            } else if (associateResult !== wantCnt) {
                console.log(`\n del fail, associate result ${associateResult} !== ${wantCnt}, `, r)
                process.exit(9)
            }
            process.stdout.write(`   delete id ${r.id}, epoch ${r.epoch}, result ${associateResult}  `)
            if (associateResult === list.length * 2 || associateResult === 0) {
                break;
            }
        }
        epoch = min as number;
    } while (true)
    console.log(` \n done.`)
}
if (require.main === module) {
    const args = process.argv.slice(2)
    const from = Number(args[0])
    init().then(cfg=>{
        const cfx = new Conflux(cfg.conflux)
        patchHttpProvider(cfx, cfg.conflux)
        const dmNode = new DummyNode(cfx)
        if (args.includes('delete')) {
            return doDeletion(from);
        } else if (args.includes('loop')) {
            return loop(from, dmNode)
        } else {
            return processOne(from, dmNode)
        }
    }).then(()=>{
        return CfxBill.sequelize.close()
    })
}
/*

select * from cfx_transfer where epoch=10173721;
select * from cfx_bill where ownerId in(12133,1624472,93,15) and epoch=10173721 and diffDrip > 0;

select * from bak_cfx_transfer order by epoch desc limit 5;
delete from bak_cfx_transfer where epoch = 11259237;

select distinct(fromId) , 'from' as who from bak_cfx_transfer
union
select distinct(toId) , 'to' as who from bak_cfx_transfer
;
 */
/*

select * from cfx_transfer where epoch=3859051;
select * from bak_cfx_transfer where epoch=3859051;
select * from bak_cfx_transfer order by epoch desc limit 5;
select * from cfx_bill where ownerId in(5795,99886,93,15) and epoch=3859051 and diffDrip > 0;

select t.*, hex40.hex from
(select count(*) as cnt, fromId as id, 'from' as who from bak_cfx_transfer group by fromId
union
select count(*) as cnt, toId as id, 'to' as who from bak_cfx_transfer group by toId
) t left join hex40 on t.id = hex40.id
where hex40.hex like '1%'
;

bad case:
https://confluxscan.io/address/cfx:acfgmctw40vy2a608uey5g9t32b8m4kp1268zwhrh1?limit=10&reverse=true&skip=0&tab=transfers-CFX&transactionHash=0x3fa4207b5d84bb82660040fa833dab9fec9c091ca44fe0a526cc0782249a5514&txType=outgoing
 */