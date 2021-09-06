import {CfxBalance} from "../../model/Balance";
import {CfxWatcher} from "../watcher/BalanceWatcher";
import {Hex40Map} from "../../model/HexMap";
import {init} from "./FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";

async function watchCfx(col, watcher: CfxWatcher) {
    const byBal = await CfxBalance.findAll({
        order: [[col, 'desc']], limit: 500
    })
    for (const row of byBal) {
        const hex = await Hex40Map.findByPk(row.addressId)
        await watcher.queryBalance(`0x${hex.hex}`, row.addressId)
    }
}
async function fixCfx(watcher: CfxWatcher) {
    await watchCfx('balance', watcher)
    await watchCfx('stakingBalance', watcher)
    await watchCfx('total', watcher)
    console.log(` done.`)
}

init().then(config=>{
    const cfx = new Conflux(config.conflux)
    const w = new CfxWatcher('cfx', cfx);
    return fixCfx(w);
})