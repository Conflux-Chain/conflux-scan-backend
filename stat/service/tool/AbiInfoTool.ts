import {init} from "./FixDailyTokenStat";
import {AbiInfo} from "../../model/ContractInfo";
import {sleep} from "./ProcessTool";
const superagent = require('superagent')
async function run() {
    const [,,host_] = process.argv
    let host = host_ || 'https://testnet.confluxscan.org';
    console.log(`fetch abi from ${host}`);
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
        await AbiInfo.bulkCreate(body.list, {
            updateOnDuplicate: ['updatedAt']
        })
        skip += body.list.length;
        process.stdout.write(`\r\u001b[2K created count ${body.list.length} , ${skip}`);
    } while (true)
}

async function main() {
    await init();
    await run()
    return AbiInfo.sequelize.close();
}

// node stat/service/tool/AbiInfoTool.js build-abi | tee build-abi.log
// node stat/service/tool/AbiInfoTool.js https://www.confluxscan.org
if (require.main === module) {
    main().catch(err => {
        console.log('error:', err)
        return AbiInfo.sequelize?.close()
    });
}
