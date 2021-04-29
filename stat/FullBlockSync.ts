import {loadConfig, StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Conflux} from "js-conflux-sdk";
import {FullBlockService} from "./service/FullBlockService";
import {FullBlock} from "./model/FullBlock";
import {KEY_FILL_BLOCK_PROPS_EPOCH, KV} from "./model/KV";

export async function run() {
    const config:StatConfig = loadConfig('Prod')
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)
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
        const cfx = new FullBlockService(new Conflux(config.conflux))
        await cfx.fillBlockRewardByPos()
    } else {
        await syncFullBlock(config)
    }
    seq.close().then()
}

async function syncFullBlock(config:StatConfig) {
    let cfx = new Conflux(config.conflux);
    console.log(`Conflux ${config.conflux.url} network ${(await cfx.getStatus())['networkId']}`)
    return new FullBlockService(cfx)
        // .syncBlockByEpoch(0)
        .run(always)
        .then(ret=>{
            console.log(`sync full block ret:`, ret)
        }).catch(err=>{
            console.log(`error test full block:`, err)
        })
}
const args = process.argv.slice(2)
let always = Boolean(args[0])
run().then()