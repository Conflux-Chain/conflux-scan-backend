import {init} from "./FixDailyTokenStat";
import {BatchBalanceWatcher} from "../watcher/BatchBalanceWatcher";
import {Token} from "../../model/Token";
import {StatApp} from "../../StatApp";
import {initCfxSdk} from "../common/utils";

async function run() {
    init().then(async (config) => {
        const cfx = await initCfxSdk(config.conflux);
        StatApp.networkId = cfx.networkId;
        // init contract
        let utilContract = await BatchBalanceWatcher.getUtilContractAddr();
        console.log(` net work id ${StatApp.networkId}, util contract ${ utilContract}`)
        const w = new BatchBalanceWatcher(cfx,null, utilContract)
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
                    console.log(`token balance ======= fail ${token.base32} ${token.name} ${token.symbol}, ${err.message}`)
                })
        }
    })
}
run().then()