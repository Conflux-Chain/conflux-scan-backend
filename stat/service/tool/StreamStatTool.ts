import {StatConfig} from "../../config/StatConfig";
import {RedisWrap} from "../RedisWrap";
import {init} from "./FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";
import {StatNotifier} from "../streamstat/StatNotifier";
import {TokenTransferHandler} from "../streamstat/business/TokenTransferHandler";
import {AddrTransactionHandler} from "../streamstat/business/AddrTransactionHandler";
import {AddrCfxTransferHandler} from "../streamstat/business/AddrCfxTransferHandler";
import {DailyCfxTransferHandler} from "../streamstat/business/DailyCfxTransferHandler";
import {DailyTokenTransferHandler} from "../streamstat/business/DailyTokenTransferHandler";
import {MinerBlockHandler} from "../streamstat/business/MinerBlockHandler";
import {sleep} from "./ProcessTool";

let config:StatConfig;
let cfx:Conflux;
let type: number;
let tokenTransferHandler: TokenTransferHandler;
let minerBlockHandler: MinerBlockHandler;
let addrTransactionHandler: AddrTransactionHandler;
let addrCfxTransferHandler: AddrCfxTransferHandler;
let dailyCfxTransferHandler: DailyCfxTransferHandler;
let dailyTokenTransferHandler: DailyTokenTransferHandler;

async function run() {
    config = await init();
    cfx = new Conflux(config.conflux);
    await cfx.updateNetworkId();
    patchHttpProvider(cfx, config.conflux);
    await RedisWrap.connect(config.redis);
    // console.log(`StreamStatTool------------config:${JSON.stringify(config)}`)

    const app = {cfx};
    if(type === 1){
        tokenTransferHandler = new TokenTransferHandler(app);
        minerBlockHandler = new MinerBlockHandler(app);
        addrTransactionHandler = new AddrTransactionHandler(app);
        addrCfxTransferHandler = new AddrCfxTransferHandler(app);
        dailyCfxTransferHandler = new DailyCfxTransferHandler(app);
        dailyTokenTransferHandler = new DailyTokenTransferHandler(app);

        if (config.streamStat) {
            StatNotifier.SWITCH_STREAM_STAT = config.streamStat;
            StatNotifier.SWITCH_STAT_MINER_BLOCK = config.statMinerBlock;
            StatNotifier.SWITCH_STAT_ADDR_TRANSACTION = config.statAddrTransaction;
            StatNotifier.SWITCH_STAT_DAILY_CFX_TRANSFER = config.statDailyCfxTransfer;
            StatNotifier.SWITCH_STAT_ADDR_CFX_TRANSFER = config.statAddrCfxTransfer;
            StatNotifier.SWITCH_STAT_TOKEN_TRANSFER = config.statTokenTransfer;
            StatNotifier.SWITCH_STAT_DAILY_TOKEN_TRANSFER = config.statDailyTokenTransfer;

            config.statTokenTransfer && (await tokenTransferHandler.schedule());
            config.statMinerBlock && (await minerBlockHandler.schedule());
            config.statAddrTransaction && (await addrTransactionHandler.schedule());
            config.statAddrCfxTransfer && (await addrCfxTransferHandler.schedule());
            config.statDailyCfxTransfer && (await dailyCfxTransferHandler.schedule());
            config.statDailyTokenTransfer && (await dailyTokenTransferHandler.schedule());
        }
    }
    if(type === 2){
        const testKey = 'testKey';
        let r = await RedisWrap.set(testKey, '888', 'EX', 1);
        console.log(`r------${JSON.stringify(r)}`);
        const v1 = await RedisWrap.get(testKey);
        console.log(`v1------${JSON.stringify(v1)}`);

        await sleep(2000);
        const v2 = await RedisWrap.get(testKey)
        console.log(`redis test after 2 seconds: ${testKey} = [${v2}]`)
    }
}

const args = process.argv.slice(2)
if(args[0]){
    type = Number(args[0]);
}
// console.log(`StreamStatTool------------type:${type}`);
run().then();
