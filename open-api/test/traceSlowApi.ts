import {init} from "../../stat/service/tool/FixDailyTokenStat";
import {ApiLog} from "../../stat/monitor/ApiLog";
import {NFTCheckerService} from "../../stat/service/nftchecker/NFTCheckerService";
import {StatConfig} from "../../stat/config/StatConfig";
import {Conflux, format} from "js-conflux-sdk";
import {getAddrId, Hex40Map} from "../../stat/model/HexMap";
import {TokenBalance} from "../../stat/model/Balance";

let cfg:StatConfig
async function main() {
    cfg = await init()
    const {query, rt, path, createdAt} = await ApiLog.findOne({
        where: {path: '/open/nft/tokens'}, order: [['createdAt', 'desc']]
    })
    console.log(`path ${path} rt ${rt} ${query} AT ${createdAt.toISOString()}`)
    return testNftTokens(query)
}

function parseQueryParam(query: string) {
    const parts = query.split('&')
    const params = {}
    parts.forEach(pair => {
        let [k, v] = pair.split('=')
        params[k] = /^\d+$/.test(v) ? parseInt(v) : v
    })
    console.log(`param`, params)
    return params
}

async function testNftTokens(query:string) {
    //
    const param = parseQueryParam(query);
    // holders
    const cid = await getAddrId(param['contract'])
    const holderIdList = await TokenBalance.findAll({
        where: {contractId: cid}, limit: 50,
    })
    let cfx = new Conflux(cfg.conflux)
    const svc = new NFTCheckerService({cfx})
    let i = 0
    async function repeat() {
        const {hex} = await Hex40Map.findOne({where: {id: holderIdList[i].addressId}})
        param['owner'] = format.address(`0x${hex}`, 1029)
        console.log('use owner', param['owner'])
        const start = Date.now()
        const result = await svc.getNftTokensForOpenApi(param as any)
        console.log(`${new Date().toISOString()} costs ${Date.now() - start} ms, total ${result.total}`)
        await repeat() // will hit mysql cache ?
        setTimeout(repeat, 5_000)
    }
    return repeat()
}
if (module === require.main) {
    main().catch((err)=>{
        console.log(`error:`, err)
    }).finally(()=>{
        // process.exit(0)
        // console.log(`done`)
    })
}