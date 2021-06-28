import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {DailyContractRegisterSync} from "../DailyContractRegisterSync";

let contractRegisterSync;

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)

    contractRegisterSync = new DailyContractRegisterSync(seq);
}

async function sync(startDay, endDay) {
    await contractRegisterSync.countHistory(startDay, endDay);
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
