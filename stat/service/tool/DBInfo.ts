import {AddressErc20Transfer, Erc20Transfer} from "../../model/Erc20Transfer";
import {init} from "./FixDailyTokenStat";
import {AddressCfxTransfer, CfxTransfer} from "../../model/CfxTransfer";
import {FullBlock, FullTransaction} from "../../model/FullBlock";
import {StatConfig} from "../../config/StatConfig";
import {Conflux} from "js-conflux-sdk";
import {initCfxSdk} from "../common/utils";

async function run(cfg:StatConfig) {
    const cfx = await initCfxSdk({url: cfg.conflux.url});
    return repeat(cfg, cfx)
}
async function repeat(cfg:StatConfig, cfx:Conflux) {
    const maxList = await Promise.all([
        Erc20Transfer.max('epoch').then(epoch=>{return {epoch, t:'Erc20Transfer'}}),
        AddressErc20Transfer.max('epoch').then(epoch=>{return {epoch, t:'AddressErc20Transfer'}}),
        CfxTransfer.max('epoch').then(epoch=>{return {epoch, t:'CfxTransfer'}}),
        AddressCfxTransfer.max('epoch').then(epoch=>{return {epoch, t:'AddressCfxTransfer'}}),
        FullTransaction.max('epoch').then(epoch=>{return {epoch, t:'FullTransaction'}}),
        FullBlock.max('epoch').then(epoch=>{return {epoch, t:'FullBlock'}}),
        cfx.getEpochNumber('latest_state').then(epoch=>{return {epoch, t:'conflux'}}),
    ])
    const epochOnChain = maxList[maxList.length-1].epoch
    maxList.forEach(r=>{r['delay'] = Number(epochOnChain) - Number(r.epoch)})
    const epochInfo = maxList.map(r=>`${r.t.padStart(20,' ')} epoch ${r.epoch.toString().padStart(15, ' ')}, delay ${r['delay']}`).join('\n')
    console.log(`${new Date().toISOString()}\n${epochInfo}`)
    setTimeout(()=>repeat(cfg, cfx), 1000)
}
init().then(cfg=>run(cfg));
