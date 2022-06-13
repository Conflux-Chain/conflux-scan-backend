import {init} from "../../stat/service/tool/FixDailyTokenStat";
import {ApiLog} from "../../stat/monitor/ApiLog";
import {NFTCheckerService} from "../../stat/service/nftchecker/NFTCheckerService";

async function main() {
    await init()
    const {query, rt, path, createdAt} = await ApiLog.findOne({
        where: {path: ''}, order: [['createdAt', 'desc']]
    })
    console.log(`path ${path} rt ${rt} ${createdAt.toISOString()}`)
    return testNftTokens(query)
}

function parseQueryParam(query: string) {
    const parts = query.split('&')
    const params = {}
    parts.forEach(pair => {
        const [k, v] = pair.split('=')
        params[k] = v
    })
    return params
}

async function testNftTokens(query:string) {
    const param = parseQueryParam(query);
    const svc = new NFTCheckerService({})
    async function repeat() {
        const start = Date.now()
        await svc.getNFTTokens({contractAddress: param['contract'], ownerAddress: param['owner']})
        console.log(`costs ${Date.now() - start} ms`)
        setTimeout(repeat, 5_000)
    }
    return repeat()
}
if (module === require.main) {
    main().then(()=>{

    }).finally(()=>{
        process.exit(0)
        console.log(`done`)
    })
}