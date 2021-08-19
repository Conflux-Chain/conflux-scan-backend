import {loadConfig} from "../../config/StatConfig";
import {ContractInfo, IContractInfo, saveAbiInfo} from "../../model/ContractInfo";
import { makeId } from "../../model/HexMap";
import { StatApp } from "../../StatApp";
import {createDB, initModel} from "../DBProvider";
import { TxnQuery } from "../TxnQuery";
import {ContractVerify} from "../../model/ContractVerify";
const superagent = require("superagent")
const zlib = require('zlib');

let fixed = 0
let missing = 0
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
        await saveAbiInfo(abi).then()
        console.log(`generate abi info for ${v.base32}`)
    }
}
async function run() {
    await init();
    // await doItFromScan();
    await parseVerified()
}
async function doItFromScan() {
    const resp = await superagent.get(`${scanSyncApiUrl}/announce-db-info`).timeout(10_000)
    let {min,max} = resp.body
    console.log(`min ${min} max ${max}`);
    
    const contractInfo = [];
    while(min<max) {
        const info = (await superagent.get(`${scanSyncApiUrl}/announce-get-by-id?id=${min}`).timeout(10_000)).body
        const key = new String(Buffer.from(info.key, 'base64'))
        if (key.endsWith('/name') && key.startsWith('contract/') && !isAbi) {
            let value = new String(Buffer.from(info.value, 'base64'))
            if (value.length >= 120) {
                value = value.substr(0,128)
            }
            console.log(`id ${min} key ${key}\n value ${value}`);
            
            contractInfo.push({name: value, hex40: key.split('/')[1], epoch: info.epochNumber});
        } else if (key.endsWith('/abi') && key.startsWith('contract/') && isAbi) {
            let abi = {}
            let unzipStr: string = 'not set';
            try {
                unzipStr = Buffer.from(zlib.unzipSync(Buffer.from(info.value, "base64"))).toString();
                abi = JSON.parse(unzipStr)
                saveAbiInfo(abi).then()
            } catch (e) {
                console.log(`parse json fail,key ${key}: unzip is ${unzipStr.replace(/[\r\n ]/g,'')}`)
                // if (unzipStr.length > 10) process.exit(0)
            }
        }
        min++
    }
    if (contractInfo.length && save && !isAbi) {
        await batchSaveContractInfo(contractInfo, new Date().getTime()/1000);
    }
    console.log(`save ${contractInfo.length}`);
    ContractInfo.sequelize.close().then();
    
}
export async function batchSaveContractInfo(array: {name:string, hex40:string, epoch:number}[], seconds) {
    let templates:IContractInfo[] = []
    for (const obj of array) {
        // hex address should exists already.
        const hexId = (await makeId(obj.hex40)).id
        const base32 = TxnQuery.base32(obj.hex40, StatApp.networkId)
        templates.push({id: 0, base32, name:obj.name, epoch:obj.epoch, hexId})
    }
    return ContractInfo.bulkCreate(templates,{
        // logging: console.log
    }).catch(err=>{
        console.log(`ContractInfo.bulkCreate fail:`, err)
        throw err
    })
}
let scanSyncApiUrl = 'http://localhost:8887'
const args = process.argv.slice(2)
const isAbi = Boolean(args[0] === 'abi')
StatApp.networkId = Number(args[1])
let save = Boolean(args[2])
// usage: node this [contract|abi] networkId [save]
run().then();