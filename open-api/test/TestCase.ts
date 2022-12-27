import {getApiService} from "../ApiServer";
import {enablePerformance, performance_mark} from "../../common/tool.js";


export async function checkTest() {
    const[,,cmd, arg1, arg2] =  process.argv

    async function once(account, sort='DESC', to=undefined) {
        const {total} = await getApiService().fullBlockQuery.listTransaction({
            accountAddress: account, sort, to
        });
        console.log(`total tx`, total)
    }

    if (cmd === 'test-list-tx') {
        enablePerformance();
        for (let i = 0; i < parseInt(arg2); i++) {
            console.log(`----- round ${i} `)
            let mark = performance_mark(undefined, 'begin')
            await once(arg1)
            performance_mark(mark, 'cost')
        }
        console.log(`test sort ASC`)
        await once(arg1,'ASC')
        console.log(`test more condition`)
        await once(arg1,'ASC', arg1)
        console.log(`test full tx`)
        await once(undefined,'DESC', undefined)
        process.exit(0)
    }
}