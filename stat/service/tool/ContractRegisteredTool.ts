import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {DailyContractRegisterSync} from "../DailyContractRegisterSync";
import {DailyContractCreate} from "../../model/DailyContractCreate";

let type: number;
let startDay;
let endDay;
let contractRegisterSync;

async function init() {
    const config = loadConfig('Prod')
    let seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)
    // console.log(`config-----------${JSON.stringify(config)}`)

    contractRegisterSync = new DailyContractRegisterSync(seq);
}

async function syncDeployed() {
    const rows = await DailyContractCreate.findAll({
        attributes: ['id', 'statDay', 'contractCount'],
        order: [['statDay', 'asc']],
    });

    let contractTotal = 0;
    for(const row of rows){
        contractTotal = contractTotal + row.contractCount;

        const effectRows = await DailyContractCreate.update({contractTotal}, {where: {id: row.id}});
        console.log(`id:${row.id}------statDay:${row.statDay}------contractTotal:${contractTotal}------effectRows:${effectRows}`);
    }
}

async function syncRegister(startDay, endDay) {
    await contractRegisterSync.countHistory(startDay, endDay);
}

async function run(startDay, endDay) {
    await init();
    if(type === 1){
        await syncDeployed();
    }
    if(type === 2){
        await syncRegister(startDay, endDay);
    }
}

//              0       1
// node this startDayStr endDayStr
const args = process.argv.slice(2)
type = args[0] ? Number(args[0]) : undefined;
startDay = args[1] ? new Date(args[1]) : undefined;// format '2020/10/29'
endDay = args[2] ? new Date(args[2]) : undefined;
run(startDay, endDay).then();
