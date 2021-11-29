import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {DailyBlockDataStatSync} from "../DailyBlockDataStatSync";
import {init} from "./FixDailyTokenStat";
import {BlockAndMinerSync} from "../BlockAndMinerSync";
import {MinerBlock} from "../../model/MinerBlock";
import {Epoch} from "../../model/Epoch";

let blockDataStatTool;

async function sync(startDay, endDay) {
    await blockDataStatTool.statHistory(startDay, endDay);
}

async function syncByHour() {
    await blockDataStatTool.statByHour();
}

async function run(startDay, endDay) {
    await init();
    if (args.includes('miner')) {
        const dt = await Epoch.max('timestamp') as any;
        await new BlockAndMinerSync().rollupByHour(dt)
        await MinerBlock.sequelize.close()
        return;
    }
    blockDataStatTool = new DailyBlockDataStatSync();
    await sync(startDay, endDay);
    // await syncByHour();
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
