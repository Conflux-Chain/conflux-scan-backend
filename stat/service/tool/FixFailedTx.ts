import {FailedTx, FullTransaction} from "../../model/FullBlock";
import {Op} from 'sequelize'
import {FullBlockService} from "../FullBlockService";
import {init} from "./FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
async function listFailedTx(epoch, range) {
    return FullTransaction.findAll({where:{epoch:{[Op.between]:[epoch, epoch+range]}, status:{[Op.ne]:0}},})
}
async function patch(list:FullTransaction[]) {
    const tasks = []
    for (const tx of list) {
        tasks.push(FullBlockService.syncFailedTx0(tx.epoch, tx.blockPosition, tx.txPosition, tx.hash, cfx).then(info=>{
            if (info) return FailedTx.create(info)
        }))
    }
    const ret = await Promise.all(tasks).catch(err=>{
        console.log(`\n error:`, err)
        return -1
    })
    if (ret === -1) {
        return -1
    }
    return tasks.length
}
async function iterAllTx(from) {
    const stop = await FullTransaction.max('epoch')
    const batch = 100
    while(from <= stop) {
        const list = await listFailedTx(from, batch-1)
        const cnt = await patch(list)
        if (cnt === -1) {
            break;
        }
        process.stdout.write(`\r\u001b[2K fixed count ${cnt.toString().padStart(3,' ')}, to epoch ${from+batch}, will stop at ${stop}  $`)
        from += batch
    }
    console.log(`\n Done ${from}`)
    return FullTransaction.sequelize.close()
}
const args = process.argv.slice(2)
let from = Boolean(args[0])
let cfx:Conflux
init().then((ccc)=>{
    cfx = new Conflux(ccc.conflux)
    return iterAllTx(Number(from))
})