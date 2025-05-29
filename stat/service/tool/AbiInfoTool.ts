import {init} from "./FixDailyTokenStat";
import {AbiInfo, saveAbiInfo} from "../../model/ContractInfo";
import {sleep} from "./ProcessTool";
import {ContractVerify} from "../../model/ContractVerify";
import {getAddrId, makeIdV} from "../../model/HexMap";
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

async function buildAbiForVerifiedContract() {
    const cList = await ContractVerify.findAll({
        attributes: ['id', 'name', 'abi', 'base32', 'implementation'],
        where: {verifyResult: true}, raw: true}
    );
    console.log(`contract count`, cList.length);
    let idx = 0;
    for (const contractVerify of cList) {
        idx ++;
        const {id, name, abi, base32, implementation} = contractVerify;
        const hexId = await makeIdV(base32);
        if (!hexId) {
            console.log(`hex id ${hexId} not found, id ${id} name [${name}] ${base32}`);
            continue;
        }
        process.stdout.write(`\r\u001b[2K  ${idx} / ${cList.length} `);
        const ok = await saveAbiInfo(abi, hexId);
        if (!ok) {
            break;
        }
    }
}

async function main() {
    await init();
    const [,,cmd] = process.argv;
    if (cmd === 'build-abi') {
        await buildAbiForVerifiedContract();
    } else {
        await run()
    }
}

// node stat/service/tool/AbiInfoTool.js build-abi
// node stat/service/tool/AbiInfoTool.js https://www.confluxscan.org
if (require.main === module) {
    main().catch(err => {
        console.log('error:', err)
        return AbiInfo.sequelize?.close()
    });
}
