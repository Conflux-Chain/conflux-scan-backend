import {Conflux} from "js-conflux-sdk";
import {CfxBalance} from "../../model/Balance";
import {CfxWatcher} from "../watcher/BalanceWatcher";
import {Hex40Map} from "../../model/HexMap";
import {init} from "./FixDailyTokenStat";
import {StatApp} from "../../StatApp";
import {initCfxSdk} from "../common/utils";

async function watchCfx(col, watcher: CfxWatcher) {
    const byBal = await CfxBalance.findAll({
        order: [[col, 'desc']], limit: 500
    })
    for (const row of byBal) {
        const hex = await Hex40Map.findByPk(row.addressId)
        await watcher.queryBalance(`0x${hex.hex}`, row.addressId)
    }
}
async function fixCfx(watcher: CfxWatcher, cfx: Conflux) {
    await cfx.updateNetworkId()
    //@ts-ignore
    StatApp.networkId = (await cfx.getStatus()).networkId

    await watchCfx('balance', watcher)
    await watchCfx('stakingBalance', watcher)
    await watchCfx('total', watcher)
    console.log(` done.`)
    process.exit(0)
}

init().then(async (config) => {
    const cfx = await initCfxSdk(config.conflux);
    const w = new CfxWatcher('cfx', cfx);
    return fixCfx(w, cfx);
})