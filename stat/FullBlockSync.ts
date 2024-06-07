import {redirectLog} from "./config/LoggerConfig";
import {loadConfig, StatConfig} from "./config/StatConfig";
import {autoAddPartition, createDB, initModel} from "./service/DBProvider";
import {format} from "js-conflux-sdk";
import {FullBlockService} from "./service/FullBlockService";
import {FullBlock, loadMaxBlockEpoch} from "./model/FullBlock";
import {
    IS_EVM2, KEY_CIP1559_BLOCK_HEIGHT,
    KEY_FILL_BLOCK_PROPS_EPOCH,
    KEY_GAS_USED_PER_SECOND_NOTIFY,
    KV
} from "./model/KV";
import {initCfxSdk} from "./service/common/utils";
import {PowSidePosSync} from "./service/pos/PowSidePosSync";
import {regExitHook} from "./service/tool/ProcessTool";
import {checkApiLogIpField} from "./monitor/ApiLog";
import {StatApp} from "./StatApp";

export async function run() {
    const config:StatConfig = loadConfig('Prod')

    let cfx = await initCfxSdk(config.blockSyncRpc);
    PowSidePosSync.POS_CONTRACT_VERBOSE = format.address(PowSidePosSync.POS_CONTRACT_HEX, cfx.networkId, true)

    let seq = createDB(config.databaseRW)
    await initModel(seq)
    if (config.database.syncSchema) {
        console.log(`sync model begin...`);
        await seq.sync({})
        console.log(`sync model finished.`);
    } else {
        console.log(`skip sync db schema.`);
    }
    setInterval(()=>autoAddPartition(seq), 600_000)
    await checkApiLogIpField()

    StatApp.isEVM = await KV.getSwitch(IS_EVM2);
    StatApp.cip1559BlkHeight = await KV.getNumber(KEY_CIP1559_BLOCK_HEIGHT)
    let cfx2
    if(StatApp.isEVM) {
        cfx2 = await initCfxSdk(config.conflux2)
    }
    const svc = new FullBlockService(cfx, cfx2)
    if (args[0] === 'fix') {
        // batch size 10, loop 1 time:
        // node this fix 10 1
        const batchSize = Number(args[1] || 1)
        let loop = Number(args[2] || 1)
        do {
            await FullBlockService.fillPropsBatch(batchSize)
        } while (--loop > 0)
        const maxEpochInBlock = await loadMaxBlockEpoch()
        const fixedPos = await KV.getNumber(KEY_FILL_BLOCK_PROPS_EPOCH)
        console.log(`\n fillPropsBatch done. maxEpochInBlock ${maxEpochInBlock
        }, fixPos ${fixedPos}, ${fixedPos >= maxEpochInBlock ? 'ok, fixed' : 'need fix more.'}`);
    } else if(args[0] === 'reward') {
        await svc.fillBlockRewardByPos()
    } else {
        if (!StatApp.isEVM) {
            // evm doesn't care miner and reward
            svc.fillBlockRewardByPos().then();
        }
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
if (module === require.main) {
    redirectLog()
    regExitHook()
    run().then()
}
