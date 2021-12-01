// replay transfer records, build balance table.
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Op} from 'sequelize'
import {handleTokenTransferWithContract} from "../../StreamSync";
import {init} from "./FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";
import {StatApp} from "../../StatApp";
import {BatchBalanceWatcher} from "../watcher/BatchBalanceWatcher";

const args = process.argv.slice(2)
const from = parseInt(args[0])
async function loop(from) {
    const batch = 1000
    const model = Erc20Transfer
    const maxId = await model.max('id')
    do {
        const list = await model.findAll({
            where: {id: {[Op.between]:[from, from+batch-1]}}
        })
        const map = new Map<number,Set<number>>()
        for (const t of list) {
            let set = map.get(t.contractId)
            if (!set) {
                set = new Set<number>()
                map.set(t.contractId, set)
            }
            set.add(t.fromId)
            set.add(t.toId)
        }
        await handleTokenTransferWithContract(map, false)
        process.stderr.write(`\r\u001b[2K replay: id ${from}, max ${maxId} , ${from * 100 / Number(maxId)}%    ` )
        from += batch
        if (from >= maxId) {
            break;
        }
    } while (true)
    console.log(` replay: done, max ${maxId}`)
}
async function setup(config){
    const cfx = new Conflux(config.conflux)
    await cfx.updateNetworkId()
    patchHttpProvider(cfx, config.conflux)
    // init contract
    // @ts-ignore
    StatApp.networkId = (await cfx.getStatus()).networkId
    console.log(` network id ${StatApp.networkId}`)
    const utilContract = await BatchBalanceWatcher.getUtilContractAddr();
    console.log(` util contract ${utilContract}`)
    new BatchBalanceWatcher(cfx,null, utilContract)
}
init().then((config)=> {
    return setup(config)
}).then(()=>{
    loop(from).then()
})
