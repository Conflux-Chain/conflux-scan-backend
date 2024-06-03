import {loadMaxBlockEpoch, markBlockPosition, markTxPosition} from "../../model/FullBlock";
import {init} from "./FixDailyTokenStat";
import {CfxTransferRowMark, checkCfxTransferCountKV, markCfxTransferPosition} from "../../model/CfxTransfer";
import {FullBlockService} from "../FullBlockService";

async function main() {
    const args = process.argv.slice(2)
    await init()
    let maxEpoch:number = await loadMaxBlockEpoch()
    maxEpoch -= 1000;
    if ('block' === args[0]) {
        await markBlockPosition(9_000, maxEpoch);
        await FullBlockService.checkBlockCountKV(true)
    } else if ('tx' === args[0]) {
        await markTxPosition(9_000, maxEpoch)
        await FullBlockService.checkTxCountKV(true)
    } else if ('cfx_transfer' === args[0]) {
        await markCfxTransferPosition(9_000, maxEpoch)
        await checkCfxTransferCountKV(true)
    } else {
        console.log(`what ? [block | tx | cfx_transfer]`)
    }
    await CfxTransferRowMark.sequelize.close()
}

main().then()
// node stat/service/tool/RowMarker tx 1
// node stat/service/tool/RowMarker cfx_transfer 1
