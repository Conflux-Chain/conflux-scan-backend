import {loadConfig, StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Conflux} from "js-conflux-sdk";
import {FullBlockService} from "./service/FullBlockService";

export async function run() {
    const config:StatConfig = loadConfig('Prod')
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)
    await syncFullBlock(config)
    seq.close().then()
}

async function syncFullBlock(config:StatConfig) {
    let cfx = new Conflux(config.conflux);
    console.log(`network ${(await cfx.getStatus())['networkId']}`)
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