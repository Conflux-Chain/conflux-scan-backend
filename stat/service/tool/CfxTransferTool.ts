import {init} from "./FixDailyTokenStat";
import {Conflux, format} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";
import {FullTransaction} from "../../model/FullBlock";
import {AddressCfxTransfer, CfxTransfer} from "../../model/CfxTransfer";
import {getAddrId} from "../../model/HexMap";
import {getCfxTransferTraces, setCfxSync} from "../../CfxTransferSync";

async function fixStaking() {
    const cfg = await init();
    const cfx = new Conflux(cfg.conflux)
    patchHttpProvider(cfx, cfg.conflux);
    const st = await cfx.getStatus();
    console.log(`-----  net ${st.networkId} ------`)
    setCfxSync(cfx)
    const stakingContractAddrId = await getAddrId('0x0888000000000000000000000000000000000002')
    const txList = await AddressCfxTransfer.findAll({
        where: {addressId: stakingContractAddrId}, order: [['epoch','desc']]
    })
    console.log(` tx count ${txList.length}`)
    for (let i = 0; i < txList.length; i++) {
        const {epoch, blockIndex, txIndex} = txList[i]
        const traces = await getCfxTransferTraces(epoch, false)
        // do not fix full cfx table, it will
        const dbX = await CfxTransfer.findAll({
            where: {epoch, blockIndex, txIndex}
        })
        if (dbX.length === 0 && traces.result.length) {
            await CfxTransfer.sequelize.transaction(async dbTx=>{
                await Promise.all([
                    CfxTransfer.bulkCreate(traces.result, {transaction: dbTx}),
                    AddressCfxTransfer.bulkCreate(traces.addrBeans, {transaction: dbTx}),
                ])
            })
            console.log(`fix it, epoch ${epoch} ${blockIndex} ${txIndex}`)
            break
        } else {
            console.log(`skip, epoch ${epoch} ${blockIndex} ${txIndex} db cfx-x ${dbX.length}, traces ${traces.result.length}`)
        }
    }
    console.log(`done.`)
}

if (module === require.main) {
    fixStaking().then(()=>{
        process.exit(0)
    })
}