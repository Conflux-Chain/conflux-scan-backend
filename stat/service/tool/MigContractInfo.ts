import {loadConfig} from "../../config/StatConfig";
import {saveAbiInfo} from "../../model/ContractInfo";
import { StatApp } from "../../StatApp";
import {createDB, initModel} from "../DBProvider";
import {ContractVerify} from "../../model/ContractVerify";

async function init() {
    const config = loadConfig('Prod')
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)
}

async function parseVerified() {
    const list = await ContractVerify.findAll({where: {verifyResult: true}})
    for (let i = 0; i < list.length; i++){
        let v = list[i];
        const abi = JSON.parse(v.abi)
        await saveAbiInfo(abi)
        console.log(`generate abi info for ${v.base32}`)
    }
}
async function run() {
    await init();
    // await doItFromScan();
    await parseVerified()
}
const args = process.argv.slice(2)
StatApp.networkId = Number(args[1])
// usage: node this [contract|abi] networkId [save]
run().then();