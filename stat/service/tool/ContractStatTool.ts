import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {DailyContractStatSync} from "../DailyContractStatSync";

let contractStatTool;

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)

    contractStatTool = new DailyContractStatSync(seq);
}

async function sync(startDay, endDay) {
    await contractStatTool.statHistory(startDay, endDay);
}

async function run(startDay, endDay) {
    await init();
    await sync(startDay, endDay);
}

//              0       1
// node this startDayStr endDayStr
const args = process.argv.slice(2)
const startDay = args[0] ? new Date(args[0]) : undefined;// format '2020/10/29'
const endDay = args[1] ? new Date(args[1]) : undefined;
run(startDay, endDay).then();
