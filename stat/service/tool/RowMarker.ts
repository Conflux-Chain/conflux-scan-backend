import {BlockRowMark, markBlockPosition, markTxPosition} from "../../model/FullBlock";
import {init} from "./FixDailyTokenStat";
import {CfxTransferRowMark, markCfxTransferPosition} from "../../model/CfxTransfer";

async function markBloc() {

}
const args = process.argv.slice(2)
if ('block' === args[0]) {
    init().then(() =>
        markBlockPosition(Number(args[1]))
    ).then(() => {
        return BlockRowMark.sequelize.close()
    }).then()
} else if ('tx' === args[0]) {
    init().then(() =>
        markTxPosition(Number(args[1]))
    ).then(() => {
        return BlockRowMark.sequelize.close()
    }).then()
} else if ('cfx_transfer' === args[0]) {
    init().then(() =>
        markCfxTransferPosition(Number(args[1] || 1))
    ).then(() => {
        return CfxTransferRowMark.sequelize.close()
    }).then()
} else {
    console.log(`what ? [block | tx | cfx_transfer]`)
}
