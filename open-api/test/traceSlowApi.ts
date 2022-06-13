import {init} from "../../stat/service/tool/FixDailyTokenStat";
import {ApiLog} from "../../stat/monitor/ApiLog";
import {NFTCheckerService} from "../../stat/service/nftchecker/NFTCheckerService";
import {StatConfig} from "../../stat/config/StatConfig";
import {Conflux} from "js-conflux-sdk";

let cfg:StatConfig
async function main() {
    cfg = await init()
    const {query, rt, path, createdAt} = await ApiLog.findOne({
        where: {path: '/open/nft/tokens'}, order: [['createdAt', 'desc']]
    })
    console.log(`path ${path} rt ${rt} ${createdAt.toISOString()}`)
    return testNftTokens(query)
}

function parseQueryParam(query: string) {
    const parts = query.split('&')
    const params = {}
    parts.forEach(pair => {
        let [k, v] = pair.split('=')
        params[k] = /\d+/.test(v) ? parseInt(v) : v
    })
    return params
}

async function testNftTokens(query:string) {
    const param = parseQueryParam(query);
    let cfx = new Conflux(cfg.conflux)
    const svc = new NFTCheckerService({cfx})
    async function repeat() {
        const start = Date.now()
        const result = await svc.getNftTokensForOpenApi(param as any)
        console.log(`costs ${Date.now() - start} ms, total ${result.total}`)
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