import {AddressErc20Transfer, build20transferList2address, Erc20Transfer} from "../../model/Erc20Transfer";
import {init} from "./FixDailyTokenStat";
import {Op} from 'sequelize'
import {AddressErc721Transfer, Erc721Transfer} from "../../model/Erc721Transfer";
import {AddressErc777Transfer, Erc777Transfer} from "../../model/Erc777Transfer";
import {AddressErc1155Transfer, Erc1155Transfer} from "../../model/Erc1155Transfer";
import {AddressCfxTransfer, CfxTransfer} from "../../model/CfxTransfer";
import {FullBlock, FullTransaction} from "../../model/FullBlock";
import {StatConfig} from "../../config/StatConfig";
import {Conflux} from "js-conflux-sdk";

async function run(cfg:StatConfig) {
    const cfx = new Conflux({url: cfg.conflux.url})
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
