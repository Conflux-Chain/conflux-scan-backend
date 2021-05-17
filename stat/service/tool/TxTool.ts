import {BlockRowMark, FullTransaction, markBlockPosition, markTxPosition} from "../../model/FullBlock";
import {init} from "./FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";

const args = process.argv.slice(2)
if ('txMethod' === args[0]) {
    init().then(async (config) => {
        const maxTx = await FullTransaction.findOne({order: [["epoch","desc"]], limit: 1})
        console.log(`max epoch ${maxTx.epoch}`)
        //
        const cfx = new Conflux(config.conflux)
        // node this txMethod baseTxId round
        let baseId = Number(args[1])
        let round = Number(args[2])
        while(round>=0 && baseId<=maxTx.epoch) {
            const txList = await FullTransaction.findAll({where:{epoch: baseId}})
            for (let tx of txList) {
                const txInfo = await cfx.getTransactionByHash(tx.hash)
                // @ts-ignore
                await FullTransaction.update({method: txInfo.data.substr(0,10)},{
                    where: {epoch: tx.epoch, blockPosition: tx.blockPosition, txPosition: tx.txPosition}
                })
            }
            process.stdout.write(`\r\u001b[2K Left round${round}, epoch ${baseId} update tx ${txList.length}`)
            baseId++
            round --
        }
        console.log(`\n done`)
    }).then(()=>{
        return FullTransaction.sequelize.close()
    })
}else {
    console.log(`what ? [txMethod]`)
}