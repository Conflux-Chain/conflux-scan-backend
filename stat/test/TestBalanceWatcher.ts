import {Conflux} from "js-conflux-sdk";
import {BalanceWatcher, DexCfxWatcher} from "../service/watcher/BalanceWatcher";
import {makeId} from "../model/HexMap";
import {DexCfxBalance} from "../model/Balance";

export async function queryBalance() {
    console.log(`begin query balance.`)
    let cfx = new Conflux({url: 'http://main.confluxrpc.org/v2'})
    let ctct = '0x8d7df9316faa0586e175b5e6d03c6bda76e3d950' // wcfx
    const w = new DexCfxWatcher(ctct, cfx)
    await w.schedule()
    // const hex = '0x144f812a17421871ce1abd5c35f6faaed33e8755' // unknown address from scan
    const hex = ''; // dex-cfx
    let bean;
    bean = await makeId(hex)
    await w.queryBalance(hex, bean.id)
    await w.queryBalance(hex, bean.id)
    const balanceBean = await DexCfxBalance.findByPk(bean.id)
    console.log('balance updated : ', balanceBean)
}