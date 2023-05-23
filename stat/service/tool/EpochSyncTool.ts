// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {makeId} from "../../model/HexMap";
import {Contract} from "../../model/Contract";
import {Token} from "../../model/Token";
import {Transaction} from "sequelize";
import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {TokenTool} from "./TokenTool";
import {CONST} from "../common/constant";
import {StatApp} from "../../StatApp";
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";
const lodash = require('lodash');
const zlib = require('zlib');
const INTERFACE_ERC_721 = [0x80, 0xac, 0x58, 0xcd];
const INTERFACE_ERC_1155 = [0xd9, 0xb6, 0x7a, 0x26];

let cfx;
let networkId;
let tokenTool;
let seq;
let startEpochNumber;
let endEpochNumber;

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)

    cfx = new Conflux({...config.conflux})
    tokenTool = new TokenTool(cfx);
}

//----------------- get and save -----------------
async function getData(epochNumber) {
    const groupedLogs = await getLogsGrouped(epochNumber);
    const announceInfo = undefined;//await getAnnounceInfo(epochNumber, groupedLogs.announcementArray);
    const tokenArray = await getTokensAutoDetected(groupedLogs);

    const modelData = { announceInfo, tokenArray };
    return modelData;
}

async function save(epochNumber, modelData) {
    await saveAnnounceInfo(epochNumber, modelData.announceInfo);

    const tokenArray = modelData.tokenArray;
    if(tokenArray?.length){
        console.log(`epoch-sync.detect, token:${tokenArray.length}`)
    }
    for(const token of tokenArray){
        await Token.upsert(token).catch(e => console.log(`epoch-sync.detect, token:${JSON.stringify(token)}`, e));
    }
}

// ----------------------- business method for token ------------------------
async function getTokensAutoDetected({ transfer20Array, transfer721Array, transfer1155Array }) {
    let tokenArray = [];
    try{
        const [crc20AddressArray, crc721AddressArray, crc1155AddressArray]  = await Promise.all([
            [... new Set(transfer20Array.map(item => item.address).filter(Boolean))],
            [... new Set(transfer721Array.map(item => item.address).filter(Boolean))],
            [... new Set(transfer1155Array.map(item => item.address).filter(Boolean))]
        ]);
        if(crc20AddressArray.length){
            tokenArray = [...tokenArray, ...await getTokens(crc20AddressArray, CONST.TRANSFER_TYPE.ERC20)];
        }
        if(crc721AddressArray.length){
            tokenArray = [...tokenArray, ...await getTokens(crc721AddressArray, CONST.TRANSFER_TYPE.ERC721)];
        }
        if(crc1155AddressArray.length){
            tokenArray = [...tokenArray, ...await getTokens(crc1155AddressArray, CONST.TRANSFER_TYPE.ERC1155)];
        }
    }catch (e){
        console.log(`epoch-sync.getTokensAutoDetected fail`, e);
    }
    return tokenArray;
}

async function getTokens(hexAddressArray, transferType){
    const tokenArray = [];
    for(const hex40 of hexAddressArray){
        const token = await getToken(hex40, transferType);
        console.log(`[hex40=${hex40}]getToken------${JSON.stringify(token)}`)
        token && tokenArray.push(token);
    }
    return tokenArray;
}

async function getToken(hexAddress, transferType){
    const hex40id = (await makeId(hexAddress)).id;
    const tokenDb = await Token.findOne({where: {hex40id}, raw: true});
    if(tokenDb && tokenDb.type){
        return undefined;
    }

    const base32 = format.address(hexAddress, StatApp.networkId);
    console.log(`[hexAddress=${hexAddress}]address------${JSON.stringify(base32)}`)
    const [ totalSupply, tokenInfo, erc721Interface, erc1155Interface ] = await Promise.all([
        tokenTool.getTokenTotalSupply(base32),
        tokenTool.getToken(base32),
        tokenTool.supportsInterface(base32, INTERFACE_ERC_721),
        tokenTool.supportsInterface(base32, INTERFACE_ERC_1155),
    ]);
    console.log(`[hexAddress=${hexAddress}][transferType=${transferType}]totalSupply------${JSON.stringify(totalSupply)}`)
    console.log(`[hexAddress=${hexAddress}][transferType=${transferType}]tokenInfo------${JSON.stringify(tokenInfo)}`)
    console.log(`[hexAddress=${hexAddress}][transferType=${transferType}]erc721Interface------${JSON.stringify(erc721Interface)}`)
    console.log(`[hexAddress=${hexAddress}][transferType=${transferType}]erc1155Interface------${JSON.stringify(erc1155Interface)}`)
    if((transferType === CONST.TRANSFER_TYPE.ERC721 && erc721Interface === false) ||
        (transferType === CONST.TRANSFER_TYPE.ERC1155 && erc1155Interface === false)){
        console.log(`[hexAddress=${hexAddress}][transferType=${transferType}]------undefined`)
        return undefined;
    }

    let token = lodash.defaults({}, { hex40id, base32, name: tokenInfo.name, symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals, granularity: tokenInfo.granularity, totalSupply,
        type: transferType});
    console.log(`[hexAddress=${hexAddress}][transferType=${transferType}]token------${JSON.stringify(token)}`)
    const transferCount = (await countTransfer(hex40id, transferType)) || 1;
    console.log(`[hexAddress=${hexAddress}][transferType=${transferType}]transferCount------${JSON.stringify(transferCount)}`)
    const auditResult = (token?.name?.trim()?.length > 0) && (token?.symbol?.trim()?.length > 0);
    console.log(`[hexAddress=${hexAddress}][transferType=${transferType}]auditResult------${JSON.stringify(auditResult)}`)
    token = lodash.defaults(token, {transfer: transferCount, auditResult, fetchBalance: auditResult });
    return token;
}

async function countTransfer(addressId, transferType) {
    if(transferType === CONST.TRANSFER_TYPE.ERC20)
        return Erc20Transfer.count({ where: { contractId: addressId }});
    if(transferType === CONST.TRANSFER_TYPE.ERC721)
        return Erc721Transfer.count({ where: { contractId: addressId }});
    if(transferType === CONST.TRANSFER_TYPE.ERC1155)
        return Erc1155Transfer.count({ where: { contractId: addressId }});
}

//--------------------- announce ---------------------
 async function saveAnnounceInfo(epochNumber, {tokenArray, contractArray}, dbTx: Transaction = undefined) {
    for (const token of tokenArray) {
        const tokenDb: Token = await Token.findOne({where: {base32: token.base32},
            transaction: dbTx, raw: true});
        if(tokenDb){
            const updateInfo = lodash.defaults({}, {icon: token.icon, quoteUrl: token.quoteUrl, updatedAt: new Date()});
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
    if(tokenArray?.length || contractArray?.length){
        console.log(`announcement------tokenArray:${JSON.stringify(tokenArray)}------contractArray:${JSON.stringify(contractArray)}`);
    }
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
    console.log(`[epochNumber=${epochNumber}]groupedLogs------${JSON.stringify(groupedLogs)}`)
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
    console.log(`[epochNumber=${epochNumber}]eventLogArray------${JSON.stringify(eventLogArray)}`)
    return eventLogArray.map((v) => parseEventLog(v));
}

function parseEventLog(eventLog) {
    eventLog.epochNumber = Number(eventLog.epochNumber);
    eventLog.address = format.hexAddress(eventLog.address);
    eventLog.transactionLogIndex = Number(eventLog.transactionLogIndex);
    return eventLog;
}

// -------------------------------- run -------------------------------
async function run(startEpochNumber, endEpochNumber) {
    await init();
    while(startEpochNumber<=endEpochNumber){
        const modelData = await getData(startEpochNumber);
        console.log(`modelData------${JSON.stringify(modelData)}`)
        /*
        await save(startEpochNumber, modelData);
        if(startEpochNumber % 100 === 0){
            console.log(`epoch:${startEpochNumber} processed`);
        }
        */
        startEpochNumber = startEpochNumber + 1;
    }
    console.log(`done`);
}

const args = process.argv.slice(2);
networkId = Number(args[0]);
if(args[1]){
    startEpochNumber = Number(args[1]);
}
if(args[2]){
    endEpochNumber = Number(args[2]);
}

run(startEpochNumber, endEpochNumber).then();

