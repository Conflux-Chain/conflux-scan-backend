import {init} from "./FixDailyTokenStat";
import {BalanceWatcher, Erc20Watcher} from "../watcher/BalanceWatcher";
import {Conflux} from "js-conflux-sdk";
import {BatchBalanceWatcher} from "../watcher/BatchBalanceWatcher";

async function run() {
    init().then(async (config)=>{
        const cfx = new Conflux(config.conflux)
        // @ts-ignore
        await cfx.updateNetworkId()
        const w = new BatchBalanceWatcher(cfx, config.erc20watchList, null)
        config.erc20watchList.forEach(token=>{
            BatchBalanceWatcher.getBalances(config.erc20watchList[0].address, [token.address])
                .then(()=>{
                    console.log(`token balance ok ${token.address} ${token.name}`)
                })
                .catch(err=>{
                    console.log(`token balance ======= fail ${token.address} ${token.name}`)
                })
        })
        const erc20 = {"name":"conDragon","address":"0x83928828f200b79b78404dce3058ba0c8c4076c3","watchDelay":30,"tokenType":"ERC1155"}
        const watcher = new Erc20Watcher(erc20.name, erc20.address, this.cfx, {tokenType: erc20.tokenType})
        return watcher.schedule(erc20.watchDelay)
    })
}
run().then()