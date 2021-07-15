import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {DailyBlockDataStatSync} from "../DailyBlockDataStatSync";

let blockDataStatTool;

async function init() {
    const config = loadConfig('Prod')
    // console.log(`config-----------${JSON.stringify(config)}`)
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)

    blockDataStatTool = new DailyBlockDataStatSync(seq);
}

async function sync(startDay, endDay) {
    await blockDataStatTool.statHistory(startDay, endDay);
}

async function run(startDay, endDay) {
    await init();
    await sync(startDay, endDay);
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
