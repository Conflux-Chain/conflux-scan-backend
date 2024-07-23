import {init} from "./FixDailyTokenStat";
import {AbiInfo} from "../../model/ContractInfo";
import {sleep} from "./ProcessTool";
const superagent = require('superagent')
async function run() {
    const [,,host_] = process.argv
    let host = host_ || 'https://testnet.confluxscan.io'
    let skip = 0
    do {
        const res = await superagent.get(`${host}/stat/devops/view-table?t=abi_info&skipStr=${skip}`)
        // core and evm have different response
        const body = res.body?.data || res.body?.result
        if (body.code === 429) {
            await sleep(1000)
            continue
        }
        if (!body?.list?.length) {
            console.log(`error ? `, res.body || res)
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
        skip += 10
        console.log(`create count ${body.list.length} , ${skip} / ${body.total}`)
    } while (true)
}

if (require.main === module) {
    init().then(run).catch(err=>{
        console.log('error:', err)
        return AbiInfo.sequelize.close()
    })
}
