import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {makeId} from "../../model/HexMap";
import {StatApp} from "../../StatApp";
import {Contract} from "../../model/Contract";
// @ts-ignore
const { address ,format} = require('js-conflux-sdk');
const superagent = require("superagent")
const lodash = require('lodash');

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)
}

async function run() {
    await init();
    await sync();
}

async function sync() {
    let skip = 0;
    let total;
    let currPage = 1;
    do{
        let response = await list(skip, pageSize).catch(err=>{
            console.log(`error get contract_list from scan:`, err)
        });
        if(!response) return;
        total = total ? total : response.total;
        console.log('sync contract_list currPage------', currPage, ',skip------', skip, ',total------', total );

        const contractList = response.list;
        for (const c of contractList) {
            let base32 =  c.address;
            if(base32.startsWith('CFX')){
                base32 = address.simplifyCfxAddress(base32);
            }
            const contract: any = await query(base32);
            const dbContract: Contract = await Contract.findOne({where: {base32}});
            if(dbContract){
                const t = lodash.assign(dbContract, {name: contract.name, website: contract.website,
                    abi: contract.abi,
                    sourceCode: contract.sourceCode,
                    icon: contract.icon, updatedAt: Date.now()});
                console.log(`sync contract_list update-----------------------${JSON.stringify(t)}` );
                if(save){
                    await dbContract.update(t, {where: {id: dbContract.id}});
                }
            } else{
                const hex40 = format.hexAddress(contract.address);
                const hex40id = (await makeId(hex40)).id;
                const t = lodash.assign({base32, hex40id}, {epoch: contract.epochNumber, name: contract.name, website: contract.website,
                    abi: contract.abi,
                    sourceCode: contract.sourceCode,
                    icon: contract.icon});
                console.log(`sync contract_list insert-----------------------${JSON.stringify(t)}` );
                if(save){
                    await Contract.add(t);
                }
            }
        }
        skip = (++currPage - 1) * pageSize ;
    } while (skip <= total);
}

async function list(skip: number = 0, limit: number = 10): Promise<{ total: number, list: any }>{
    const response = await superagent.get(`${scanApiUrl}/v1/contract`)
        .query(`skip=${skip}&limit=${limit}`)
        .timeout(3 * 60 * 1000);
    if (response.status !== 200) {
        console.log('sync contract_list fail:', JSON.stringify(response));
        return;
    }
return response.body;
}

async function query(address): Promise<any>{
    const response = await superagent.get(`${scanApiUrl}/v1/contract/${address}`)
        .query(`fields=name&fields=website&fields=abi&fields=sourceCode&fields=icon`)
        .timeout(3 * 60 * 1000);
    if (response.status !== 200) {
        console.log('sync contract_detail fail:', JSON.stringify(response));
        return;
    }
    return response.body;
}

let scanApiUrl = 'https://www.confluxscan.io'
const pageSize = 100;
const args = process.argv.slice(2)
StatApp.networkId = Number(args[0])
let save = Boolean(args[1])
// usage: node this [contract|abi] networkId [save]
run().then();