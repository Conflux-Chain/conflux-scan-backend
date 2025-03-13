import {redirectLog} from "./config/LoggerConfig";
import {loadConfig, StatConfig} from "./config/StatConfig";
import {autoAddPartition, createDB, initModel} from "./service/DBProvider";
import {format} from "js-conflux-sdk";
import {FullBlockService} from "./service/FullBlockService";
import {FullBlock, loadMaxBlockEpoch} from "./model/FullBlock";
import {
    IS_EVM2, KEY_EPOCH_CIP1559_ENABLED,
    KEY_FILL_BLOCK_PROPS_EPOCH,
    KV
} from "./model/KV";
import {initCfxSdk} from "./service/common/utils";
import {PowSidePosSync} from "./service/pos/PowSidePosSync";
import {regExitHook} from "./service/tool/ProcessTool";
import {StatApp} from "./StatApp";
import {CONST} from "./service/common/constant";
import {startMonitorContractCreated} from "./service/contract/PatchNoTraceContract";
import {DefaultCacheConf, startEvictCache} from "./service/common/RpcCacheManager";
import {safeAddErrorLog} from "./monitor/ErrorMonitor";

export async function run() {
    const config:StatConfig = loadConfig('Prod')

    const cfxOpt = config.blockSyncRpc;
    let cfx = await initCfxSdk(cfxOpt);
    StatApp.networkId = cfx.networkId
    PowSidePosSync.POS_CONTRACT_VERBOSE = format.address(PowSidePosSync.POS_CONTRACT_HEX, cfx.networkId, true)

    let seq = createDB(config.databaseRW)
    await initModel(seq)
    if (config.database?.syncSchema) {
        console.log(`sync model begin...`);
        await seq.sync({})
        console.log(`sync model finished.`);
    } else {
        console.log(`skip sync db schema.`);
    }
    setInterval(()=>autoAddPartition(seq), 600_000)

    StatApp.isEVM = await KV.getSwitch(IS_EVM2);

    await mustInit()

    const svc = new FullBlockService(cfx)
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
        if (config.traceNotAvailable) {
            startMonitorContractCreated().then()
        }
        if (cfxOpt.writeCache) {
            DefaultCacheConf.logPeriod = 10_000;
            DefaultCacheConf.delaySec = 30_000;
            DefaultCacheConf.cacheDir = cfxOpt.cachePath
            startEvictCache().then();
        }
        await syncFullBlock(svc)

    }
    // seq.close().then()
}

async function mustInit() {
    if(!CONST.NETWORKS_CIP1559_ENABLED.includes(StatApp.networkId)) {
        StatApp.epochCIP1559Enabled = 0
    } else{
        const epochCIP1559Enabled = await KV.getNumber(KEY_EPOCH_CIP1559_ENABLED, CONST.CHAIN_INFO[StatApp.networkId]?.EPOCH_CIP1559)
        if(!epochCIP1559Enabled) {
            console.log(`Failed to load config for epoch number at which CIP1559 enabled!`)
            process.exit(9)
        }
        StatApp.epochCIP1559Enabled = epochCIP1559Enabled
    }
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
            safeAddErrorLog('block-sync',`runner`, err);
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
