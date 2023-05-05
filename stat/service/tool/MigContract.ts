import {loadConfig} from "../../config/StatConfig";
import {createMySql, initModel} from "../DBProvider";
const fs = require('fs');
import {StatApp} from "../../StatApp";
import {ContractInfo} from "../../model/ContractInfo";
import {Contract} from "../../model/Contract";
import {Hex40Map, makeId} from "../../model/HexMap";
// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {TokenTool} from "./TokenTool";
import {ContractVerify} from "../../model/ContractVerify";
import {CONST} from "../common/constant";
const lodash = require('lodash');
const zlib = require('zlib');

let type; // 1-sync, 2-writeContractVerify, 3-insertContractVerify
let cfx;
let tokenTool;
let networkId;
let round;

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    let seq = createMySql(config.databaseRW)
    await seq.sync({})
    await initModel(seq)

    cfx = new Conflux({...config.conflux})
    tokenTool = new TokenTool(cfx);
}

async function run(round) {
    await init();
    if(type === 1){
        await sync();
    }
    if(type === 2) {
        await writeContractVerify(round);
    }
    if(type === 3){
        await insertContractVerify();
    }
    if(type === 4){
        await getVerifiedAddressArray();
    }
    if(type === 5){
        await getNotVerifiedAddressArray();
    }
    if(type === 6){
        await updateNotifyStatusForNotSynced();
    }
}

async function getVerifiedAddressArray(){
    const verifyArray = await ContractVerify.findAll({
        attributes: ['base32'],
        where: {verifyResult: true},
        raw: true
    });
    const verifyAddressJSON = JSON.stringify(verifyArray.map(item => item.base32));
    fs.writeFileSync(`${__dirname}/verifiedAddress/verified.json`, verifyAddressJSON);
}

async function getNotVerifiedAddressArray(){
    const verifyAddressJSON = await fs.readFileSync(`${__dirname}/verifiedAddress/verified.json`);
    const verifyAddressArray = JSON.parse(verifyAddressJSON);
    const notVerifyAddressArray = [];
    for (const base32 of verifyAddressArray) {
        const item = await ContractVerify.findOne({attributes: ['base32'], where: {base32, verifyResult: true}});
        if(!item) {
            notVerifyAddressArray.push(base32);
        }
    }
    const notVerifyAddressJSON = JSON.stringify(notVerifyAddressArray);
    fs.writeFileSync(`${__dirname}/verifiedAddress/not-verified.json`, notVerifyAddressJSON);
}

async function updateNotifyStatusForNotSynced(){
    const notVerifyAddressJSON = await fs.readFileSync(`${__dirname}/verifiedAddress/not-verified.json`);
    const verifyAddressArray = JSON.parse(notVerifyAddressJSON);
    for (const base32 of verifyAddressArray) {
        await ContractVerify.update({notifyStatus: CONST.NOTIFY_STATUS.NEED_NOTIFY}, {where: {base32, verifyResult: true}});
    }
}

async function writeContractVerify(round = 10){
    let minId:number = await ContractVerify.min('id');
    let maxId:number = await ContractVerify.max('id');
    console.log(`writeContractVerify start...\nround:${round}\nminId:${minId}\nmaxId:${maxId}`);

    let roundCounter = 0
    while (roundCounter < round && minId <= maxId) {
        const id = minId++;
        const verify = await ContractVerify.findByPk(id, {raw: true});
        // @ts-ignore
        if(!verify.verifyResult) continue;

        const verifyJson = JSON.stringify(verify);
        fs.writeFileSync(`${__dirname}/verifyJSON/${verify.base32}.json`, verifyJson);
        roundCounter++
    }
}

async function insertContractVerify(){
    const files = await fs.readdirSync(`${__dirname}/verifyJSON/`);
    for(const fileName of files){
        console.log(`fileName------${fileName}`)
        const content = await fs.readFileSync(`${__dirname}/verifyJSON/${fileName}`);
        const verify = JSON.parse(content);

        // const base32 = verify.base32;
        // const hex = format.hexAddress(base32);
        // const hex40 = await Hex40Map.findOne({where: {hex: hex.substr(2)}})
        // const hex40id = hex40.id;

        verify.id = undefined;
        // verify.hex40id = hex40id;
        console.log(`verify------${JSON.stringify(lodash.pick(verify, ['id','hex40id']))}`)

        try{
            await ContractVerify.add(verify);
        }catch (e) {
            const msg = `${e}`
            console.log(`ContractVerify add file,verify:${JSON.stringify(verify.base32)}, error:${msg.substr(0, 1000)}`);
        }
    }
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
networkId = Number(args[0]);
StatApp.networkId = networkId;
if(args[1]){
    type = Number(args[1]);
}
if(args[2]){
    round = Number(args[2]);
}
run(round).then();

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
