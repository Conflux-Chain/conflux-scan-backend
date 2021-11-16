import {StatConfig} from "../../config/StatConfig";
import {RedisWrap} from "../RedisWrap";
import {init} from "./FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";
import {PruneHandler} from "../prune/PruneHandler";
import {PruneNotifier} from "../prune/PruneNotifier";
import {PruneType} from "../../model/PruneInfo";

let config:StatConfig;
let cfx:Conflux;
let type: number;
let pruneHandler: PruneHandler;
let loop: number;

async function run() {
    config = await init();
    console.log(`config------------${JSON.stringify(config)}`)
    cfx = new Conflux(config.conflux);
    await cfx.updateNetworkId();
    patchHttpProvider(cfx, config.conflux);
    await RedisWrap.connect(config.redis);

    const app = {cfx};
    if(type === 1){
        pruneHandler = new PruneHandler(app);
        await pruneHandler.schedule(10);
    }
    if(type === 2){
        const message = {
            [PruneType.ERC20_TRANSFER]: [
                {
                    pruneLoop: 30000, // optional
                    delRowsPerLoop: 500, // optional
                    sleepMsPerLoop: 20, // optional
                    addressId: 13870862,
                }
            ],
            // [PruneType.ADDR_ERC20_TRANSFER]: [
            //     {
            //         pruneLoop: 10000, // optional
            //         delRowsPerLoop: 500, // optional
            //         sleepMsPerLoop: 20, // optional
            //         addressId: 33162167,
            //     }
            // ],
        };
        await PruneNotifier.notifyPrune(message);
        console.log(`message------------message:${JSON.stringify(message)}`);
    }
}

const args = process.argv.slice(2)
if(args[0]){
    type = Number(args[0]);
}
console.log(`DataPruneTool------------type:${type}`);
run().then();


