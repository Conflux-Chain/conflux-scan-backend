import {getApiService} from "../ApiServer";
import {enablePerformance, performance_mark} from "../../common/tool.js";


export async function checkTest() {
    const[,,cmd, arg1, arg2] =  process.argv

    async function once(account, sort='DESC', to=undefined, useCountCache=true) {
        const {total} = await getApiService().fullBlockQuery.listTransaction({
            accountAddress: account, sort, to, useCountCache,
        });
        console.log(`total tx`, total)
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
        process.exit(0)
    } else if (cmd === 'test-tx-20') {
        enablePerformance()
        await testTx20(arg1, arg2)
        process.exit(0)
    }
}

async function testTx20(arg1, arg2) {
    async function once({account, userCountCache, sort='DESC', from=undefined}) {
        // @ts-ignore
        const {total, list, queryWithCache, hitCache} = await getApiService().crc20transferQuery.listTransfer({
            accountAddress: account, userCountCache, from, sort,
        });
        console.log(`total`, total, 'time ', list[0]?.timestamp, 'queryWithCache', queryWithCache, 'hitCache', hitCache)
    }
    for (let i = 0; i < parseInt(arg2); i++) {
        console.log(`----- round ${i} `)
        let mark = performance_mark(undefined, 'begin')
        await once({account: arg1, userCountCache: false})
        mark = performance_mark(mark, 'cost without cache count')
        await once({account: arg1, userCountCache: true})
        mark = performance_mark(mark, 'cost WITH cache count')
    }
    console.log(`test sort`)
    await once({account: arg1, userCountCache: true, sort: 'ASC'})
    console.log(`test more condition`)
    await once({account: arg1, userCountCache: true, sort: 'ASC', from: arg1})
}