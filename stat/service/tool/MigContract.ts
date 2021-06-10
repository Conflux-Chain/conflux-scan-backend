import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {StatApp} from "../../StatApp";
import {ContractInfo} from "../../model/ContractInfo";
import {Contract} from "../../model/Contract";
import {makeId} from "../../model/HexMap";
// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {TokenTool} from "./TokenTool";
const lodash = require('lodash');
const zlib = require('zlib');

let cfx;
let tokenTool;

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)

    cfx = new Conflux({...config.conflux})
    tokenTool = new TokenTool(cfx);
}

async function run() {
    await init();
    await sync();
}

async function sync() {
    const epochList = await ContractInfo.findAll({attributes: ['epoch'], order: [['epoch', 'ASC']], raw: true});
    let epochArray = [];
    epochList.forEach(item => {
        epochArray.push(item.epoch);
    })
    console.log(`mig-contract--------------epochArray:${JSON.stringify(epochArray)}`);
    if (args.length >= 2) {
        epochArray = [];
        // @ts-ignore
        epochArray.push(Number(args[1]));
        console.log(`mig-contract--------------changed epochArray:${epochArray}`);
    }
    for(const epochNumber of epochArray){
        const {contractArray} = await getAnnounceInfo(epochNumber);
        for (const contract of contractArray) {
            const contractDb: Contract = await Contract.findOne({where: {base32: contract.base32},raw: true});
            if(contractDb){
                const updateInfo = lodash.defaults({}, {epoch: epochNumber, name: contract.name, website: contract.website,
                    abi: contract.abi, sourceCode: contract.sourceCode, icon: contract.icon, updatedAt: new Date()});
                const c = lodash.assign(contractDb, updateInfo);
                await Contract.update(c, {where: {id: contractDb.id}});
                console.log(`mig-contract--update------------epoch:${epochNumber}, name:${c.name}`);
            } else{
                const c = lodash.assign(contract, {epoch: epochNumber});
                await Contract.add(c);
                console.log(`mig-contract--add------------epoch:${epochNumber}, name:${c.name}`);
            }
        }
    }

}

//              0       1
// node this netId epochNumber
const args = process.argv.slice(2)
StatApp.networkId = Number(args[0])
run().then();

//-----------------------------------------------------------------
async function getAnnounceInfo(epochNumber) {
    let tokenMap = {};
    let contractMap = {};
    const announceArray = await getAnnounceArray(epochNumber);
    for(const announce of announceArray) {
        const key = Buffer.from(announce.key, 'base64').toString();
        const params = key.split('/');
        //console.log(`announcement------epoch:${epochNumber}------${params}`);
        if(params[0] === 'token') {
            parseAnnounce(params, announce, tokenMap);
        }
        if(params[0] === 'contract') {
            parseAnnounce(params, announce, contractMap);
        }
    }
    //console.log(`announcement------epoch:${epochNumber}------contractMap${JSON.stringify(contractMap)}`);

    const tokenArray = [];
    await Object.keys(tokenMap).map(async hex => {
        let token = tokenMap[hex];
        token.hex40id = (await makeId(hex)).id;
        token.base32 = format.address(hex, StatApp.networkId);
        const totalSupply = await tokenTool.getTokenTotalSupply(token.base32);
        const tokenInfo = await tokenTool.getToken(token.base32);
        token = lodash.defaults(token, { totalSupply, name: tokenInfo.name, symbol: tokenInfo.symbol,
            decimals: tokenInfo.decimals, granularity: tokenInfo.granularity });
        tokenArray.push(token);
    });
    const contractArray = [];
    const contractHexArray = Object.keys(contractMap);
    for(const hex of contractHexArray){
        let contract = contractMap[hex];
        contract.hex40id = (await makeId(hex)).id;
        contract.base32 = format.address(hex, StatApp.networkId);
        contractArray.push(contract);
    }
    // console.log(`announcement------epoch:${epochNumber}------contractArray:${contractArray}`);
    return {tokenArray, contractArray};
}

function parseAnnounce(params, announce, map){
    if(params[1] === 'list'){
        const [ , , hex] = params;
        map[hex] = map[hex] || {};
    } else{
        const [ , hex, field] = params;
        const item = map[hex] || {};
        item[field] = (field === 'abi' || field === 'sourceCode' || field === 'icon')
            ? Buffer.from(zlib.unzipSync(Buffer.from(announce.value, "base64"))).toString()
            : Buffer.from(announce.value, 'base64').toString();

        if (field === 'name' && item[field].length >= 256) {
            item[field] = item[field].substr(0, 256);
        }
        //console.log(`announcement------field:${field}------value:${item[field]}`);
        map[hex] = item;
    }
    return map;
}

async function getAnnounceArray(epochNumber) {
    const eventLogArray = await getLogs(epochNumber);
    return eventLogArray.map((eventLog) => tokenTool.decodeAnnounce(eventLog)).filter(Boolean);
}

async function getLogs(epochNumber) {
    const eventLogArray = await cfx.getLogs({fromEpoch: epochNumber, toEpoch: epochNumber}).catch(async err=>{
        const msg = `${err}`
        if (msg.includes('expected a numbers with less than largest epoch number.')) {
            const latest = await cfx.getEpochNumber('latest_state');
            console.log(`epoch-sync.logs epoch:${epochNumber} latestState:${latest} not executed`)
        } else {
            console.log(`epoch-sync.logs epoch:${epochNumber} error:${msg}`)
        }
        return [];
    });
    return eventLogArray.map((v) => parseEventLog(v));
}

function parseEventLog(eventLog) {
    eventLog.epochNumber = Number(eventLog.epochNumber);
    eventLog.address = format.hexAddress(eventLog.address);
    eventLog.transactionLogIndex = Number(eventLog.transactionLogIndex);
    return eventLog;
}
