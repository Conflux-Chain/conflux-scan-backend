import {PruneHandler} from "../prune/PruneHandler";
import {PruneTransfer} from "../prune/PruneTransfer";
import {PruneInfo, PruneType} from "../../model/PruneInfo";
import {Op} from 'sequelize'
import {init} from "./FixDailyTokenStat";

class TransferPrune extends PruneTransfer {
    constructor(app) {
        super(app);
        this.TYPE_TOKEN_TRANSFER.clear(); // prevent update transfer count.
    }
}
async function prune({typeStr, addrStr, del, sleep}) {
    // node this force TS_20 13870862 1000 10
    // ERC20_TRANSFER = 'TS_20', ADDR_ERC20_TRANSFER = 'AD_TS_20',
    const pruneHandler = new PruneHandler({});
    pruneHandler.pruneTransfer = new TransferPrune({});
    const addressId = parseInt(addrStr);
    await pruneHandler.pruneTransfer.prune({
        type: typeStr, pruneInfo: {
            pruneLoop: 1_000_000_000,
            delRowsPerLoop: parseInt(del),
            sleepMsPerLoop: parseInt(sleep),
            addressId,
        }
    })
    return;
}
async function pruneByExistsInfo({sleep}) {
    const token_types = [
        PruneType.ERC20_TRANSFER, PruneType.ERC721_TRANSFER, PruneType.ERC1155_TRANSFER,
        PruneType.ADDR_ERC20_TRANSFER, PruneType.ADDR_ERC721_TRANSFER, PruneType.ADDR_ERC1155_TRANSFER,
    ].map(t=>t.replace(/_2$/,''))

    const list = await PruneInfo.findAll({
        where: {type: {[Op.in]:token_types}}, order: [['pruned','desc']]
    })
    for (let i = 0; i < list.length; i++) {
        const {type, addressId, pruned} = list[i]
        await prune({typeStr: `${type}_2`, sleep, addrStr: addressId, del: pruned})
    }
}
async function start() {
    const [,,sleep, ] = process.argv
    await init();
    console.log(`-----------------`)
    await pruneByExistsInfo({sleep: parseInt(sleep)})
    console.log(` done .`)
    process.exit(0)
}
if (require.main === module) {
    start().then()
}