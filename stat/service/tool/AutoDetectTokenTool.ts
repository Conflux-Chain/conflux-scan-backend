import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {Hex40Map, makeId} from "../../model/HexMap";
// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {TokenTool} from "./TokenTool";
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";
import {TokenAutoDetect} from "../../model/TokenAutoDetect";
const lodash = require('lodash');
const CONST = require('../common/constant');

let seq;
let cfx;
let networkId;
let tokenTool;
let round;
const interfaceIdCrc721 = [0x80, 0xac, 0x58, 0xcd];
const interfaceIdCrc1155 = [0xd9, 0xb6, 0x7a, 0x26];

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)

    cfx = new Conflux({...config.conflux})
    tokenTool = new TokenTool(cfx);
}

async function detect(id) {
    const traceCreate = await TraceCreateContract.findOne({where: {id}, raw: true });
    if (traceCreate === null) {
        return undefined;
    }
    const hex40 = await Hex40Map.findByPk(traceCreate.to)
    if(!hex40){
        return undefined;
    }

    const hex40id = hex40.id;
    const hex = `0x${hex40.hex}`;
    const base32 = format.address(hex, networkId);
    const [ transfer20, transfer721, transfer1155 ] = await Promise.all([
        Erc20Transfer.findOne({ where: { contractId: hex40.id }}),
        Erc721Transfer.findOne({ where: { contractId: hex40.id }}),
        Erc1155Transfer.findOne({ where: { contractId: hex40.id }}),
    ]);
    let transferType;
    if(transfer20?.id) {
        transferType = CONST.TRANSFER_TYPE.ERC20;
    }
    if(transfer721?.id){
        transferType = CONST.TRANSFER_TYPE.ERC721;
    }
    if(transfer1155?.id){
        transferType = CONST.TRANSFER_TYPE.ERC1155;
    }
    if(transferType === undefined){
        return undefined;
    }

    const[totalSupply, tokenInfo, erc721Interface, erc1155Interface] = await Promise.all([
        tokenTool.getTokenTotalSupply(base32),
        tokenTool.getToken(base32),
        tokenTool.supportsInterface(base32, interfaceIdCrc721),
        tokenTool.supportsInterface(base32, interfaceIdCrc1155)
    ]);
    if((transferType === CONST.TRANSFER_TYPE.ERC721 && erc721Interface === false) ||
        (transferType === CONST.TRANSFER_TYPE.ERC1155 && erc1155Interface === false)){
        return undefined;
    }

    const token = lodash.defaults({}, { hex40id, base32, name: tokenInfo.name, symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals, granularity: tokenInfo.granularity, totalSupply,
        type: transferType, transfer: 0, holder: 0, auditResult: true, fetchBalance: true });
    return token;
}

async function save(tokenArray) {
    try {
        for (const token of tokenArray) {
            try{
                await TokenAutoDetect.upsert(token);
            }catch (e) {
                console.log(`autoDetectTokenTool fail,token:${JSON.stringify(token)}`, e);
            }
        }
    } catch (e) {
        console.log(`autoDetectTokenTool fail`, e);
    }
}

async function close(){
    Hex40Map.sequelize.close().then();
}

async function run(round = 10) {
    await init();

    let minId:number = await TraceCreateContract.min('id');
    let maxId:number = await TraceCreateContract.max('id');
    console.log(`autoDetectTokenTool start...\nround:${round}\nminId:${minId}\nmaxId:${maxId}`);
    let roundCounter = 0
    const erc20TokenArray = [];
    const erc721TokenArray = [];
    const erc1155TokenArray = [];
    while (roundCounter < round && minId<=maxId) {
        const token = await detect(minId++);
        if(token === undefined){
            continue;
        }
        if(token.type === CONST.TRANSFER_TYPE.ERC20){
            erc20TokenArray.push(token);
        }
        if(token.type === CONST.TRANSFER_TYPE.ERC721){
            erc721TokenArray.push(token);
            console.log(`ERC721:${JSON.stringify(token)}\n`);
        }
        if(token.type === CONST.TRANSFER_TYPE.ERC1155){
            erc1155TokenArray.push(token);
            console.log(`ERC1155:${JSON.stringify(token)}\n`);
        }
        roundCounter++
    }

    await save(erc20TokenArray);
    await save(erc721TokenArray);
    await save(erc1155TokenArray);

    console.log(`autoDetectTokenTool completed...\nerc20TokenArray:${erc20TokenArray.length}\nerc721TokenArray:${erc721TokenArray.length}\nerc1155TokenArray:${erc1155TokenArray.length}`);
    await close();
}

const args = process.argv.slice(2);
networkId = Number(args[0]);
if(args[1]){
    round = Number(args[1]);
}
run(round).then();
