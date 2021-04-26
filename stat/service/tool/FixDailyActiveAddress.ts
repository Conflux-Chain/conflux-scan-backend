import {calcDailyActiveAddress, DailyActiveAddress} from "../../model/StatAddress";

import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
async function init() {
    const config = loadConfig('Prod')
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)
}
export async function fixDate() {
    let dt = new Date('2020-10-28')
    let now = new Date()
    while( dt < now) {
        await calcDailyActiveAddress(dt)
        dt = new Date(dt.getTime() + 1000*3600*24)
    }
    console.log(`done.`)
}

if (require.main === module) {
    init().then(()=>{
        fixDate().then()
    }).then(()=>{
        DailyActiveAddress.sequelize.close().then()
    })
}