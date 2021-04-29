import {calcDailyActiveAddress, DailyActiveAddress} from "../../model/StatAddress";

import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {calcAllRegisteredTokenDailyStat, calcDailyToken, DailyTxnSync} from "../DailyTxnSync";
async function init() {
    const config = loadConfig('Prod')
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)
}
export async function fixDate(hexId=0) {
    let dt = new Date('2020-10-28')
    let now = new Date()
    while( dt < now) {
        if (hexId) {
            await calcDailyToken(dt, hexId)
        } else {
            await calcAllRegisteredTokenDailyStat(dt)
        }
        dt.setDate(dt.getDate()+1)
    }
    console.log(`done.`)
}

if (require.main === module) {
    const args = process.argv.slice(2)
    init().then(()=>{
        if (args.length === 1) {
            // node this 123
            return fixDate(Number(args[0]))
        } else if (args[0]) {
            // node this '2021-04-29' 123
            return calcDailyToken(new Date(args[0]), Number(args[1]))
        } else {
            return fixDate()
        }
    }).then(()=>{
        DailyActiveAddress.sequelize.close().then()
    })
}