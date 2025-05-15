import {init} from "./FixDailyTokenStat";
import {AbiInfo, saveAbiInfo} from "../../model/ContractInfo";
import {sleep} from "./ProcessTool";
import {ContractVerify} from "../../model/ContractVerify";
import {getAddrId} from "../../model/HexMap";
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

async function buildAbiForVerifiedContract() {
    const cList = await ContractVerify.findAll({
        attributes: ['id', 'name', 'abi', 'base32'],
        where: {verifyResult: true}, raw: true}
    );
    for (const contractVerify of cList) {
        const {id, name, abi, base32} = contractVerify;
        const hexId = await getAddrId(base32);
        if (!hexId) {
            console.log(`hex id ${hexId} not found`);
            continue;
        }
        await saveAbiInfo(abi, hexId);
    }
}

if (require.main === module) {
    init().then(run).catch(err=>{
        console.log('error:', err)
        return AbiInfo.sequelize.close()
    })
}
