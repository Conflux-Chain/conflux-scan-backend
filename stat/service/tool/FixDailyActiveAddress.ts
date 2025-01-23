import {AddressStat, calcDailyActiveAddress, DailyActiveAddress, incDailyAddressCount} from "../../model/StatAddress";

import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {Epoch} from "../../model/Epoch";
async function init() {
    const config = loadConfig('Prod')
    let seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)
}
export async function fixDate() {
    const epoch = await Epoch.findOne({where: {epoch: 1}});
    let dt = epoch.timestamp;
    let now = new Date()
    while( dt < now) {
        console.log(`fix date ${dt.toISOString()}`);
        await calcDailyActiveAddress(dt)
        dt = new Date(dt.getDate() + 1)
    }
    console.log(`done.`)
}

async function fixDailyAddrCount() {
    const epoch = await Epoch.findOne({where: {epoch: 1}});
    let dt = epoch.timestamp;
    console.log(`first day ${dt.toISOString()}`);
    const today = Date.now();
    while(dt.getTime() < today) {
        const bean = await AddressStat.findOne({where: {day: dt}});
        if (!bean) {
            await incDailyAddressCount(dt, 0);
            console.log(`create , ${dt.toISOString()}`);
        }
        dt.setDate(dt.getDate()+1);
    }
}

function main() {
    const [,,cmd] = process.argv;
    init().then(() => {
        if ('fixDailyAddr' == cmd) {
            return fixDailyAddrCount();
        } else if ('fixDate' == cmd) {
            return fixDate()
        }
    }).then(() => {
        DailyActiveAddress.sequelize.close().then()
    })
}

if (require.main === module) {
    main();
}

// node stat/service/tool/FixDailyActiveAddress.js fixDailyAddr
