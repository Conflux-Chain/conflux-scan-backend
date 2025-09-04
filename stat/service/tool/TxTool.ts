import {FullTransaction} from "../../model/FullBlock";
import {init} from "./FixDailyTokenStat";
import {initCfxSdk} from "../common/utils";
import {ethers} from "ethers";

async function main() {
    const args = process.argv.slice(2)
    if ('txMethod' === args[0]) {
        init().then(async (config) => {
            const maxTx = await FullTransaction.findOne({order: [["epoch", "desc"]], limit: 1})
            console.log(`max epoch ${maxTx.epoch}`)
            const cfx = await initCfxSdk(config.conflux);
            // node this txMethod baseTxId round
            let baseId = Number(args[1])
            let round = Number(args[2])
            while (round >= 0 && baseId <= maxTx.epoch) {
                const txList = await FullTransaction.findAll({where: {epoch: baseId}})
                const up = []
                for (let tx of txList) {
                    const txInfo = await cfx.getTransactionByHash(tx.hash)
                    // @ts-ignore
                    up.push(FullTransaction.update({method: txInfo.data.substr(0, 10)}, {
                        where: {epoch: tx.epoch, blockPosition: tx.blockPosition, txPosition: tx.txPosition}
                    }))
                }
                await Promise.all(up)
                process.stdout.write(`\r\u001b[2K Left round ${round}, epoch ${baseId} update tx ${txList.length}`)
                baseId++
                round--
            }
            console.log(`\n done`)
        }).then(() => {
            return FullTransaction.sequelize.close()
        })
    } else {
        console.log(`what ? [txMethod]`)
    }
}

export function decodeTxData(abiString:string, data:string){
    let abi;
    let decodedData;

    try{
        const abiArray = JSON.parse(abiString);
        const iFace = new ethers.utils.Interface(abiArray)
        const fn = iFace.getFunction(data.substr(0, 10))
        if (fn) {
            abi = fn.format('json')
            decodedData = iFace.decodeFunctionData(fn, data)
        }
    } catch (e){
        console.log(`${__filename}`, e.message?.startsWith("no matching function") ? e.message : e);
        return { error: `Abi decode error ${e.message}` };
    }

    return {abi, decodedData}
}
