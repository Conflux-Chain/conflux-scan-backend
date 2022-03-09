import {init} from "./FixDailyTokenStat";
import {Conflux, format} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";
import {AddressTransactionIndex, FullTransaction} from "../../model/FullBlock";
import {AddressCfxTransfer, CfxTransfer, rollupDailyCfxTxn} from "../../model/CfxTransfer";
import {getAddrId} from "../../model/HexMap";
import {getCfxTransferTraces, setCfxSync} from "../../CfxTransferSync";

async function fixStaking(cfg) {
    const cfx = new Conflux(cfg.conflux)
    patchHttpProvider(cfx, cfg.conflux);
    const st = await cfx.getStatus();
    console.log(`-----  net ${st.networkId} ------`)
    setCfxSync(cfx)
    const stakingContractAddrId = await getAddrId('0x0888000000000000000000000000000000000002')
    const txList = await AddressTransactionIndex.findAll({
        where: {addressId: stakingContractAddrId}, order: [['epoch','desc']]
    })
    console.log(` tx count ${txList.length}`)
    let fixed = 0
    for (let i = 0; i < txList.length; i++) {
        const {epoch, blockPosition: blockIndex, txPosition: txIndex} = txList[i]
        const traces = await getCfxTransferTraces(epoch, false)
        // do not fix full cfx table, it will
        const dbX = await CfxTransfer.findAll({
            where: {epoch, blockIndex, txIndex}
        })
        if (traces.result.length === 0) {
            continue
        } else if (dbX.length === 0) {
            await CfxTransfer.sequelize.transaction(async dbTx=>{
                await Promise.all([
                    CfxTransfer.bulkCreate(traces.result, {transaction: dbTx}),
                    AddressCfxTransfer.bulkCreate(traces.addrBeans, {transaction: dbTx}),
                ])
            })
            fixed ++
            console.log(`fixed count ${fixed}, , epoch ${epoch} ${blockIndex} ${txIndex}`)
            // break
        } else {
            console.log(`skip, epoch ${epoch} ${blockIndex} ${txIndex
            } db cfx-x ${dbX.length}, traces ${traces.result.length}, ${dbX[0]?.createdAt?.toISOString()}`)
        }
    }
    console.log(`done. fixed ${fixed}`)
}

async function fixDailyCfxTxn() {
    const[,,cmd,dt] = process.argv
    const date = new Date(dt)
    const now = new Date();
    while (date <= now) {
        await rollupDailyCfxTxn(date)
        console.log(`fixed ${date.toISOString()}`)
        date.setDate(date.getDate()+1)
    }
    console.log(`done`)
}
async function main() {
    const cfg = await init()
    const [, , cmd] = process.argv
    if (cmd === 'fix-daily-cfx-txn') {
        fixDailyCfxTxn().then(() => {
            process.exit(0)
        })
    } else if (cmd === 'fix-staking') {
        fixStaking(cfg).then(() => {
            process.exit(0)
        })
    }
}
if (module === require.main) {
    main().then()
}