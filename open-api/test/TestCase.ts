import {getApiService} from "../ApiServer";
import {enablePerformance, performance_mark} from "../../common/tool.js";
import {polishContract} from "../service/OpenContractService";
import {polishTransferList} from "../service/OpenTransferService";
import {TransferQueryBase} from "../../stat/service/TransferQueryBase";
import {listNFTBalances} from "../service/OpenNFTService";
import {listErc20transferByCursor} from "../service/OpenDataService";


export async function checkTest() {
    const[,,cmd, arg1, arg2] =  process.argv

    async function once(account, sort='DESC', to=undefined, useCountCache=true) {
        const {total, list} = await getApiService().fullBlockQuery.listTransaction({
            accountAddress: account, sort, to, useCountCache,
        });
        console.log(`total tx`, total, 'time ', list[0]?.timestamp)
    }

    if (cmd === 'test-list-tx') {
        enablePerformance();
        for (let i = 0; i < parseInt(arg2); i++) {
            console.log(`----- round ${i} `)
            let mark = performance_mark(undefined, 'begin')
            await once(arg1, undefined, undefined, false)
            mark = performance_mark(mark, 'cost without cache count')
            await once(arg1)
            mark = performance_mark(mark, 'cost WITH cache count')
        }
        console.log(`test sort ASC`)
        await once(arg1,'ASC')
        console.log(`test more condition`)
        await once(arg1,'ASC', arg1)
        console.log(`test full tx`)
        await once(undefined,'DESC', undefined)
    } else if (cmd === 'test-tx-20') {
        enablePerformance()
        await testTxToken(getApiService().crc20transferQuery, arg1, arg2)
    } else if (cmd === 'test-tx-721') {
        enablePerformance()
        await testTxToken(getApiService().crc721transferQuery, arg1, arg2)
    } else if (cmd === 'test-tx-1155') {
        enablePerformance()
        await testTxToken(getApiService().crc1155transferQuery, arg1, arg2)
        process.exit(0)
    } else if (cmd === 'test-tx-cfx') {
        enablePerformance()
        await testTxToken(getApiService().cfxTransferQuery, arg1, arg2)
    } else if (cmd === 'data-api-erc20') {
        const ctx = {request: {query: {cursor:'15924441_0_0_0'}}};
        await listErc20transferByCursor(ctx)
        console.log(JSON.stringify(ctx, null, 4))
    } else if (cmd === 'test-nft-balances') {
        enablePerformance()
        await testNftBalances(arg1, arg2)
    } else {
        return
    }
    process.exit(0)
}
async function testNftBalances(arg1, arg2) {
    async function once({account}) {
        let ctx = {request: {query:{owner: account}}, body: {data:{total: -1, list: []}}};
        await listNFTBalances(ctx)
        const {data:{total, list}} = ctx.body;
        console.log(`total ${total}`)
    }
    for (let i = 0; i < parseInt(arg2); i++) {
        console.log(`----- round ${i} `)
        let mark = performance_mark(undefined, 'begin')
        await once({account: arg1});
        mark = performance_mark(mark, 'cost')
    }
}
async function testTxToken(query:TransferQueryBase, arg1, arg2) {
    async function once({account, useCountCache, useAddrInfoCache, sort='DESC', from=undefined}) {
        // @ts-ignore
        const {total, list, queryWithCache, hitCache} = await query.listTransfer({
            accountAddress: account, useCountCache: useCountCache, from, sort,
        });
        const page = {list, cacheAddrInfoCount: 0};
        polishTransferList(page);
        await polishContract(page)
        console.log(`total`, total, 'time ', list[0]?.timestamp, 'queryWithCache', queryWithCache, 'hitCache', hitCache, 'cacheAddrInfoCount', page.cacheAddrInfoCount)
    }
    for (let i = 0; i < parseInt(arg2); i++) {
        console.log(`----- round ${i} `)
        let mark = performance_mark(undefined, 'begin')
        await once({account: arg1, useCountCache: false, useAddrInfoCache: false})
        mark = performance_mark(mark, 'cost without cache ')
        await once({account: arg1, useCountCache: true, useAddrInfoCache: true})
        mark = performance_mark(mark, 'cost WITH cache ')
    }
    console.log(`test sort`)
    await once({account: arg1, useCountCache: true, useAddrInfoCache: true, sort: 'ASC'})
    console.log(`test more condition`)
    await once({account: arg1, useCountCache: true, useAddrInfoCache: true, sort: 'ASC', from: arg1})
}
