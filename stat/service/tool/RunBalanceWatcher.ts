import {init} from "./FixDailyTokenStat";
import {BalanceWatcher, Erc20Watcher} from "../watcher/BalanceWatcher";
import {Conflux} from "js-conflux-sdk";
import {BatchBalanceWatcher} from "../watcher/BatchBalanceWatcher";
import {Token} from "../../model/Token";

async function run() {
    init().then(async (config)=>{
        const cfx = new Conflux(config.conflux)
        // @ts-ignore
        await cfx.updateNetworkId()
        // init contract
        const w = new BatchBalanceWatcher(cfx, config.erc20watchList, null)
        const list = await Token.findAll({
            where: {auditResult: true, fetchBalance: true},
            attributes: {
                exclude: ['icon']
            }
        })
        for (const token of list) {
            await BatchBalanceWatcher.getBalances(token.base32, [token.base32])
                .then(()=>{
                    console.log(`token balance ok ${token.base32} ${token.name} ${token.symbol}`)
                })
                .catch(err=>{
                    console.log(`token balance ======= fail ${token.base32} ${token.name} ${token.symbol}`)
                })
        }
    })
}
run().then()