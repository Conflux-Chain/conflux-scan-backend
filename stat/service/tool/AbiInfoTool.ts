import {init} from "./FixDailyTokenStat";
import {AbiInfo} from "../../model/ContractInfo";
const superagent = require('superagent')
async function run() {
    let host = 'https://testnet.confluxscan.io'
    let skip = 0
    do {
        const res = await superagent.get(`${host}/stat/devops/view-table?t=abi_info&skipStr=${skip}`)
        const body = res.body?.data
        if (!body?.list?.length) {
            break;
        }
        // console.log(`abi info:`, body)
        for (const row of body?.list) {
            //@ts-ignore
            await AbiInfo.create(row, {ignoreDuplicates: true})
        }
        await AbiInfo.bulkCreate(body.list, {
            updateOnDuplicate: ['type']
        })
        console.log(`create count ${body.list.length}`)
        skip += 10
    } while (true)
}

if (require.main === module) {
    init().then(run).catch(err=>{
        console.log('error:', err)
        return AbiInfo.sequelize.close()
    })
}
