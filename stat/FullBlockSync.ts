import {loadConfig, StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Conflux, format} from "js-conflux-sdk";
import {FullBlockService} from "./service/FullBlockService";
import {FullBlock} from "./model/FullBlock";
import {KEY_FILL_BLOCK_PROPS_EPOCH, KV} from "./model/KV";
import {patchHttpProvider} from "./service/common/utils";
import {RedisWrap} from "./service/RedisWrap";
import {PruneNotifier} from "./service/prune/PruneNotifier";
import {PowSidePosSync} from "./service/pos/PowSidePosSync";

export async function run() {
    const config:StatConfig = loadConfig('Prod')
    let cfx = new Conflux(config.conflux);
    patchHttpProvider(cfx, config.conflux, 'syncFullBlock')
    const status = await cfx.getStatus();
    console.log(`Conflux ${config.conflux.url} network ${status.networkId}`)
    PowSidePosSync.POS_CONTRACT_VERBOSE = format.address(PowSidePosSync.POS_CONTRACT_HEX, status.networkId, true)
    await RedisWrap.connect(config.redis)
    let seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)
    const svc = new FullBlockService(cfx)
    PruneNotifier.SWITCH_SYNC_PRUNE = config.syncPrune;

    if (args[0] === 'fix') {
        // batch size 10, loop 1 time:
        // node this fix 10 1
        const batchSize = Number(args[1] || 1)
        let loop = Number(args[2] || 1)
        do {
            await FullBlockService.fillPropsBatch(batchSize)
        } while (--loop > 0)
        const maxEpochInBlock = await FullBlock.max('epoch')
        const fixedPos = await KV.getNumber(KEY_FILL_BLOCK_PROPS_EPOCH)
        console.log(`\n fillPropsBatch done. maxEpochInBlock ${maxEpochInBlock
        }, fixPos ${fixedPos}, ${fixedPos >= maxEpochInBlock ? 'ok, fixed' : 'need fix more.'}`);
    } else if(args[0] === 'reward') {
        await svc.fillBlockRewardByPos()
    } else {
        svc.fillBlockRewardByPos().then();
        await syncFullBlock(svc)
    }
    // seq.close().then()
}

async function syncFullBlock(fullBlockService:FullBlockService) {
    //fullBlockService.checkReOrg = args.includes('ignoreReOrg')
    return fullBlockService
        // .syncBlockByEpoch(0)  //32420
        //.syncBlockByEpoch(30924)  //32420
        .run(always)
        .then(()=>{
            if (!always) {
                return FullBlock.sequelize.close()
            }
        }).catch(err=>{
            console.log(`error test full block:`, err)
        })
}
const args = process.argv.slice(2)
let always = true;//Boolean(args[0])
run().then()
process.on('SIGINT', ()=>process.exit(0));
process.on('SIGTERM', ()=>process.exit(0));