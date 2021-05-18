import {BlockRowMark, markBlockPosition, markTxPosition} from "../../model/FullBlock";
import {init} from "./FixDailyTokenStat";

async function markBloc() {

}
const args = process.argv.slice(2)
if ('block' === args[0]) {
    init().then(() =>
        markBlockPosition(Number(args[1] || 1))
    ).then(() => {
        return BlockRowMark.sequelize.close()
    }).then()
} else if ('tx' === args[0]) {
    init().then(() =>
        markTxPosition(Number(args[1] || 1))
    ).then(() => {
        return BlockRowMark.sequelize.close()
    }).then()
} else {
    console.log(`what ? [block | tx]`)
}