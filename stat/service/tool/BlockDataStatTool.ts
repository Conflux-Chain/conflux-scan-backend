import {loadConfig, StatConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {DailyBlockDataStatSync} from "../DailyBlockDataStatSync";
import {init} from "./FixDailyTokenStat";
import {BlockAndMinerSync} from "../BlockAndMinerSync";
import {MinerBlock} from "../../model/MinerBlock";
import {Epoch} from "../../model/Epoch";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";
import {FullBlockService} from "../FullBlockService";
import {FullBlock} from "../../model/FullBlock";

let blockDataStatTool;

async function sync(startDay, endDay) {
    await blockDataStatTool.statHistory(startDay, endDay);
}

async function syncByHour() {
    await blockDataStatTool.statByHour();
}

async function run(startDay, endDay) {
    const config = await init();
    if (args.includes('miner')) {
        const dt = await Epoch.max('timestamp') as any;
        await new BlockAndMinerSync().rollupByHour(dt)
        await MinerBlock.sequelize.close()
        return;
    } else if (args.includes('fixRecentMinerStat')) {
        await fixRecentMinerStat()
        return;
    } else if (args.includes('fixTxFee')) {
        await fixBlockTxFee(config)
        return
    }
    blockDataStatTool = new DailyBlockDataStatSync();
    await sync(startDay, endDay);
    // await syncByHour();
}
async function fixRecentMinerStat() {
    let now = new Date();
    const svc = new BlockAndMinerSync();
    for (let i=0; i<24; i++) {
        await svc.rollupByHour(now)
        now.setHours(now.getHours() - 1)
        console.log(` fix at ${now.toISOString()}`)
    }
}
async function fixBlockTxFee(config: StatConfig) {
    const cfx = new Conflux(config.conflux)
    patchHttpProvider(cfx, config.conflux)
    const svc = new FullBlockService(cfx)
    let epoch = await FullBlock.max('epoch') as any
    const stop = new Date('2021-11-29').getTime()
    do {

        await svc.fillBlockReward(epoch)
        const ep = await Epoch.findByPk(epoch)
        if (ep === null || ep.timestamp.getTime() < stop) {
            break;
        }
        if (epoch % 1000 === 0) {
            console.log(` fix epoch ${epoch}, time ${ep.timestamp.toISOString()}`)
        }
        epoch --;
    } while (true)
    console.log(`done.`)
}
//              0       1
// node this startDayStr endDayStr
const args = process.argv.slice(2)
const startDate = new Date(args[0]);
const endDate = new Date(args[1]);
// console.log(`tool.startDate------------------------${startDate}`)
// console.log(`tool.endDate------------------------${endDate}`)
const startDay = args[0] ? startDate : undefined;// format '2020/10/29'
const endDay = args[1] ? endDate : undefined;
run(startDay, endDay).then();
