// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {makeId} from "../../model/HexMap";
import {Contract} from "../../model/Contract";
import {Token} from "../../model/Token";
import {Transaction} from "sequelize";
import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {TokenTool} from "./TokenTool";
const lodash = require('lodash');
const zlib = require('zlib');

let cfx;
let networkId;
let tokenTool;
let seq;
let epochNumber;

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)

    cfx = new Conflux({...config.conflux})
    tokenTool = new TokenTool(cfx);
}

//----------------- get and save -----------------
async function getData(epochNumber) {
    const groupedLogs = await getLogsGrouped(epochNumber);
    const announceInfo = await getAnnounceInfo(epochNumber, groupedLogs.announcementArray);
    const modelData = { announceInfo };
    return modelData;
}

async function save(epochNumber, modelData) {
        await saveAnnounceInfo(epochNumber, modelData.announceInfo);
}

//--------------------- announce ---------------------
 async function saveAnnounceInfo(epochNumber, {tokenArray, contractArray}, dbTx: Transaction = undefined) {
    for (const token of tokenArray) {
        const tokenDb: Token = await Token.findOne({where: {base32: token.base32},
            transaction: dbTx, raw: true});
        if(tokenDb){
            const updateInfo = lodash.defaults({}, {icon: token.icon, quoteUrl: token.quoteUrl,
                marketCapId: token.marketCapId, moonDexSymbol: token.moonDexSymbol,
                binanceSymbol: token.binanceSymbol, updatedAt: new Date()});
            const t = lodash.assign(tokenDb, updateInfo);
            // await Token.update(t, {where: {id: tokenDb.id}, transaction: dbTx});
        } else{
            const t = lodash.assign(token, {holder: 0});
            // await Token.add(t, dbTx);
        }
    }
    for (const contract of contractArray) {
        const contractDb: Contract = await Contract.findOne({where: {base32: contract.base32},
            transaction: dbTx, raw: true});
        if(contractDb){
            const updateInfo = lodash.defaults({}, {epoch: epochNumber, name: contract.name, website: contract.website,
                abi: contract.abi, sourceCode: contract.sourceCode, icon: contract.icon, updatedAt: new Date()});
            const c = lodash.assign(contractDb, updateInfo);
            // await Contract.update(c, {where: {id: contractDb.id}, transaction: dbTx});
        } else{
            const c = lodash.assign(contract, {epoch: epochNumber});
            // await Contract.add(c, dbTx);
        }
    }
}

 async function getAnnounceInfo(epochNumber, announceArray) {
    let tokenMap = {};
    let contractMap = {};
    for(const announce of announceArray) {
        const key = Buffer.from(announce.key, 'base64').toString();
        const params = key.split('/');
        console.log(`announcement------epoch:${epochNumber}------key:${key}------value:${JSON.stringify(announce.value)}`);
        if(params[0] === 'token') {
            parseAnnounce(epochNumber, params, announce, tokenMap);
        }
        if(params[0] === 'contract') {
            parseAnnounce(epochNumber, params, announce, contractMap);
        }
    }

    const tokenArray = [];
    const tokenHexArray = Object.keys(tokenMap);
    for(const hex of tokenHexArray){
        let token = tokenMap[hex];
        token.hex40id = (await makeId(hex)).id;
        token.base32 = format.address(hex, networkId);
        const totalSupply = await tokenTool.getTokenTotalSupply(token.base32);
        const tokenInfo = await tokenTool.getToken(token.base32);
        token = lodash.defaults(token, { totalSupply, name: tokenInfo.name, symbol: tokenInfo.symbol,
            decimals: tokenInfo.decimals, granularity: tokenInfo.granularity });
        tokenArray.push(token);
    }
    const contractArray = [];
    const contractHexArray = Object.keys(contractMap);
    for(const hex of contractHexArray){
        let contract = contractMap[hex];
        contract.hex40id = (await makeId(hex)).id;
        contract.base32 = format.address(hex, networkId);
        contractArray.push(contract);
    }
    console.log(`announcement------tokenArray:${JSON.stringify(tokenArray)}------contractArray:${JSON.stringify(contractArray)}`);
    return {tokenArray, contractArray};
}

function parseAnnounce(epochNumber, params, announce, map){
    if(params[1] === 'list'){
        const [ , , hex] = params;
        map[hex] = map[hex] || {};
    } else{
        const [ , hex, field] = params;
        const item = map[hex] || {};
        item[field] = (field === 'abi' || field === 'sourceCode' || field === 'icon')
            ? Buffer.from(zlib.unzipSync(Buffer.from(announce.value, "base64"))).toString()
            : Buffer.from(announce.value, 'base64').toString();
        if(field === 'name'){
            console.log(`parseAnnounce------epoch:${epochNumber}-----field:${field}------announce:${JSON.stringify(announce)}`);
        }
        if (field === 'name' && item[field].length >= 256) {
            item[field] = item[field].substr(0, 256);
        }

        map[hex] = item;
    }
    return map;
}

// -------------------------------- event log -------------------------------
 async function getLogsGrouped(epochNumber) {
    const eventLogArray = await getLogs(epochNumber);
    const groupedLogs = {
        transfer20Array: [],
        transfer721Array: [],
        transfer1155Array: [],
        announcementArray: [],
    };

    for(const eventLog of eventLogArray) {
        const [transfer20, transfer721, transfer1155, announcement] = await Promise.all([
            tokenTool.decodeERC20Transfer(eventLog),
            tokenTool.decodeERC721Transfer(eventLog),
            tokenTool.decodeERC1155TransferArray(eventLog),
            tokenTool.decodeAnnounce(eventLog),
        ]);
        if(transfer20) {groupedLogs.transfer20Array.push(transfer20);}
        if(transfer721) {groupedLogs.transfer721Array.push(transfer721);}
        if(transfer1155) {groupedLogs.transfer1155Array.push(transfer1155);}
        if(announcement) {groupedLogs.announcementArray.push(announcement);}
    }
    return groupedLogs;
}

 async function getLogs(epochNumber) {
    const eventLogArray = await cfx.getLogs({fromEpoch: epochNumber, toEpoch: epochNumber}).catch(async err=>{
        const msg = `${err}`
        if (msg.includes('expected a numbers with less than largest epoch number.')) {
            const latest = await cfx.getEpochNumber('latest_state');
            console.log(`epoch-sync.eventLogArray epoch:${epochNumber} latestState:${latest} not executed`)
        } else {
            console.log(`epoch-sync.eventLogArray epoch:${epochNumber} error:${msg}`)
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

// -------------------------------- run -------------------------------
async function run(epochNumber) {
    await init();
    const modelData = await getData(epochNumber);
    await save(epochNumber, modelData);
}

const args = process.argv.slice(2);
networkId = Number(args[0]);
if(args[1]){
    epochNumber = Number(args[1]);
}

run(epochNumber).then();

