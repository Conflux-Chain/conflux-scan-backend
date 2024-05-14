import {loadMaxBlockEpoch, markBlockPosition, markTxPosition} from "../../model/FullBlock";
import {init} from "./FixDailyTokenStat";
import {CfxTransferRowMark, markCfxTransferPosition} from "../../model/CfxTransfer";
import {FullBlockService} from "../FullBlockService";

async function main() {
    const args = process.argv.slice(2)
    await init()
    let maxEpoch:number = await loadMaxBlockEpoch()
    maxEpoch -= 1000;
    if ('block' === args[0]) {
        await markBlockPosition(Infinity, maxEpoch);
        if (args[1]) {
            await FullBlockService.checkBlockCountKV(true)
        }
    } else if ('tx' === args[0]) {
        await markTxPosition(Infinity, maxEpoch)
        if (args[1]) {
            await FullBlockService.checkTxCountKV(true)
        }
    } else if ('cfx_transfer' === args[0]) {
        await markCfxTransferPosition(Infinity, maxEpoch)
    } else {
        console.log(`what ? [block | tx | cfx_transfer]`)
    }
    await CfxTransferRowMark.sequelize.close()
}

main().then()
