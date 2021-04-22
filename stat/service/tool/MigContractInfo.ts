import {loadConfig} from "../../config/StatConfig";
import { batchSaveContractInfo, ContractInfo } from "../../model/ContractInfo";
import { StatApp } from "../../StatApp";
import {createDB, initModel} from "../DBProvider";
const superagent = require("superagent")
let fixed = 0
let missing = 0
async function init() {
    const config = loadConfig('Prod')
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)
}
async function run() {
    await init();
    await doIt();
}
async function doIt() {
    const resp = await superagent.get(`${scanSyncApiUrl}/announce-db-info`).timeout(10_000)
    let {min,max} = resp.body
    console.log(`min ${min} max ${max}`);
    
    const contractInfo = [];
    while(min<max) {
        const info = (await superagent.get(`${scanSyncApiUrl}/announce-get-by-id?id=${min}`).timeout(10_000)).body
        const key = new String(Buffer.from(info.key, 'base64'))
        if (key.endsWith('/name')) {
            let value = new String(Buffer.from(info.value, 'base64'))
            if (value.length >= 120) {
                value = value.substr(0,128)
            }
            console.log(`id ${min} key ${key}\n value ${value}`);
            
            contractInfo.push({name: value, hex40: key.split('/')[1], epoch: info.epochNumber});
        }
        min++
    }
    if (contractInfo.length && save) {
        await batchSaveContractInfo(contractInfo, new Date().getTime()/1000);
    }
    console.log(`save ${contractInfo.length}`);
    ContractInfo.sequelize.close().then();
    
}
let scanSyncApiUrl = 'http://localhost:8887'
const args = process.argv.slice(2)
StatApp.networkId = Number(args[0])
let save = Boolean(args[1])
// usage: node this networkId [save]
run().then();