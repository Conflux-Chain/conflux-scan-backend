// replay transfer records, build balance table.
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Op} from 'sequelize'
import {handleTokenTransferWithContract} from "../../StreamSync";
import {init} from "./FixDailyTokenStat";

const args = process.argv.slice(2)
const from = parseInt(args[0])
async function loop(from) {
    const batch = 1000
    const model = Erc20Transfer
    const maxId = await model.max('id')
    do {
        const list = await model.findAll({
            where: {id: {[Op.between]:[from, from+batch-1]}}
        })
        const map = new Map<number,Set<number>>()
        for (const t of list) {
            let set = map.get(t.contractId)
            if (!set) {
                set = new Set<number>()
                map.set(t.contractId, set)
            }
            set.add(t.fromId)
            set.add(t.toId)
        }
        await handleTokenTransferWithContract(map)
        process.stdout.write(`\r\u001b[2K id ${from}, max ${maxId}     ` )
        from += batch
        if (from >= maxId) {
            break;
        }
    } while (true)
    console.log(` done, max ${maxId}`)
}
init().then(()=>{
    loop(from).then()
})
