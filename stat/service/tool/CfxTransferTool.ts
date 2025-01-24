import {init} from "./FixDailyTokenStat";
import {initCfxSdk} from "../common/utils";
import {AddressTransactionIndex, FullBlock} from "../../model/FullBlock";
import {AddressCfxTransfer, CfxTransfer, rollupDailyCfxTxn} from "../../model/CfxTransfer";
import {getAddrId} from "../../model/HexMap";
import {EpochHashCfxTransfer, getCfxTransferTraces, setCfxSync} from "../../CfxTransferSync";

async function fixStaking(config) {
    const cfx = await initCfxSdk(config.conflux);
    console.log(`-----  networkId ${cfx.networkId} ------`)

    setCfxSync(cfx)
    const stakingContractAddrId = await getAddrId('0x0888000000000000000000000000000000000002')
    const txList = await AddressTransactionIndex.findAll({
        where: {addressId: stakingContractAddrId}, order: [['epoch','desc']]
    })
    console.log(` tx count ${txList.length}`)
    let fixed = 0
    for (let i = 0; i < txList.length; i++) {
        const {epoch, blockPosition: blockIndex, txPosition: txIndex} = txList[i]
        const traces = await getCfxTransferTraces(epoch)
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

export async function findCfxSyncMaxDate() {
    const maxTag = await EpochHashCfxTransfer.findOne({order:[['epoch', 'desc']]});
    if (!maxTag) {
        return null;
    }
    const blk = await FullBlock.findOne({where: {epoch: maxTag.epoch}});
    if (!blk) {
        return null;
    }
    return blk.createdAt;
}


export async function fixDailyCfxTxn(fromT: Date = null, endT: Date) {
    if (!fromT) {
        const blk = await FullBlock.findOne({order: [['epoch', 'asc']], offset: 1});
        if (!blk) {
            return;
        }
        fromT = blk.createdAt;
    }
    const date = fromT;
    while (date <= endT) {
        await rollupDailyCfxTxn(date)
        console.log(`fixed ${date.toISOString()}`)
        date.setDate(date.getDate()+1)
    }
}
async function main() {
    const config = await init()
    const [, , cmd] = process.argv
    if (cmd === 'fix-daily-cfx-txn') {
        fixDailyCfxTxn(null, await findCfxSyncMaxDate()).then(() => {
            process.exit(0)
        })
    } else if (cmd === 'fix-staking') {
        fixStaking(config).then(() => {
            process.exit(0)
        })
    }
}
if (module === require.main) {
    main().then()
}

// node stat/service/tool/CfxTransferTool.js fix-daily-cfx-txn 2020-10-29
