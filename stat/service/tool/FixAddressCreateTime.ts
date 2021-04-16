import {Hex40Map} from "../../model/HexMap";
import {Trace} from "../../model/Trace";
import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
let fixed = 0
let missing = 0
async function init() {
    const config = loadConfig('Prod')
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)
}
async function run(round) {
    await init();
    // for each address (by id asc), if its creation time is null,
    // fetch from trace table, query by `to`
    let minId:number = await Hex40Map.min('id', {where: {createdAt: null}})
    let maxId:number = await Hex40Map.max('id', {where: {createdAt: null}})
    let rnd = 0
    while (rnd < round && minId<=maxId) {
        await checkAddr(minId++)
        rnd++
    }
    console.log(`round ${round} , fixed ${fixed} , missing ${missing}, min id ${minId}, max id ${maxId}`)
    Hex40Map.sequelize.close().then()
}

async function checkAddr(id: number) {
    const hex40 = await Hex40Map.findByPk(id)
    if (hex40 === null) {
        return
    }
    if (hex40.createdAt !== null) {
        return;
    }
    let minBlockTime:Date = await Trace.min('blockTime', {where: {to: id}});
    if (minBlockTime === null) {
        missing ++
        console.log(`min block time is null, id ${id}, hex 0x${hex40.hex}`)
        return;
    }
    hex40.createdAt = minBlockTime
    await hex40.save({fields:['createdAt']})
    fixed ++
}

const args = process.argv.slice(2)
run(Number(args[0])).then()