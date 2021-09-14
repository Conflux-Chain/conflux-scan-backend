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
import {IToken, Token} from "../../model/Token";
const lodash = require('lodash');
const CONST = require('../common/constant');
import {TokenQuery} from "../TokenQuery";
import {StatApp} from "../../StatApp";

let seq;
let cfx;
let networkId;
let tokenTool;
let round;
let saveType;
let tokenSymbol;
const interfaceIdCrc721 = [0x80, 0xac, 0x58, 0xcd];
const interfaceIdCrc1155 = [0xd9, 0xb6, 0x7a, 0x26];
let service;

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)

    cfx = new Conflux({...config.conflux})
    tokenTool = new TokenTool(cfx);

    const app = {cfx, sequelize: seq};
    service = new TokenQuery(app);
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

    let token = lodash.defaults({}, { hex40id, base32, name: tokenInfo.name, symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals, granularity: tokenInfo.granularity, totalSupply,
        type: transferType});
    const transferCount = (await countTransfer(hex40id, transferType)) || 1;
    const auditResult = (token?.name?.trim()?.length > 0) && (token?.symbol?.trim()?.length > 0);
    token = lodash.defaults(token, {transfer: transferCount, auditResult, fetchBalance: auditResult });
    return token;
}

async function countTransfer(addressId, transferType) {
    if(transferType === CONST.TRANSFER_TYPE.ERC20)
        return  Erc20Transfer.count({ where: { contractId: addressId }});
    if(transferType === CONST.TRANSFER_TYPE.ERC721)
        return Erc721Transfer.count({ where: { contractId: addressId }});
    if(transferType === CONST.TRANSFER_TYPE.ERC1155)
        return Erc1155Transfer.count({ where: { contractId: addressId }});
}

async function save(tokenArray) {
    for (const token of tokenArray) {
        try{
            if(tokenSymbol !== undefined) {
                if(tokenSymbol === token.symbol){
                    await TokenAutoDetect.upsert(token);
                    return;
                }
            } else {
                const dbToken = await TokenAutoDetect.findOne({where: {base32: token.base32}});
                if(!dbToken){
                    await TokenAutoDetect.upsert(token);
                }
            }
            console.log(`autoDetectTokenTool upsert token:${JSON.stringify(token)}`);
        }catch (e) {
            console.log(`autoDetectTokenTool fail,token:${JSON.stringify(token)}`, e);
        }
    }
}

async function close(){
    Hex40Map.sequelize.close().then();
}

async function test(){
    const result = await service.listLatest({accountAddress: '', type: 'ERC20'});
    console.log(`listAddressLatest result:${JSON.stringify(result)}`);
}

async function run(round = 10) {
    await init();

    // let minId:number = await TraceCreateContract.min('id');
    // let maxId:number = await TraceCreateContract.max('id');
    // console.log(`autoDetectTokenTool start...\nround:${round}\nminId:${minId}\nmaxId:${maxId}`);
    // let roundCounter = 0
    // const erc20TokenArray = [];
    // const erc721TokenArray = [];
    // const erc1155TokenArray = [];
    // while (roundCounter < round && minId<=maxId) {
    //     const token = await detect(minId++);
    //     if(token === undefined){
    //         continue;
    //     }
    //     if(token.type === CONST.TRANSFER_TYPE.ERC20){
    //         erc20TokenArray.push(token);
    //     }
    //     if(token.type === CONST.TRANSFER_TYPE.ERC721){
    //         erc721TokenArray.push(token);
    //     }
    //     if(token.type === CONST.TRANSFER_TYPE.ERC1155){
    //         erc1155TokenArray.push(token);
    //     }
    //     roundCounter++
    // }
    //
    // if(saveType === 1){
    //     await save(erc20TokenArray);
    // }
    // if(saveType === 2) {
    //     await save(erc721TokenArray);
    // }
    // if(saveType === 3) {
    //     await save(erc1155TokenArray);
    // }

    // console.log(`autoDetectTokenTool completed...\nerc20TokenArray:${erc20TokenArray.length}\nerc721TokenArray:${erc721TokenArray.length}\nerc1155TokenArray:${erc1155TokenArray.length}`);
    await test();
    await close();
}

const args = process.argv.slice(2);
networkId = Number(args[0]);
StatApp.networkId = networkId;
if(args[1]){
    round = Number(args[1]);
}
if(args[2]){
    saveType = Number(args[2]);
}
if(args[3]){
    tokenSymbol = args[3];
}
console.log(`params======networkId:${networkId}======round:${round}======saveType:${saveType}======tokenSymbol:${tokenSymbol}======tokenSymbol.TYPE:${typeof tokenSymbol}`);
run(round).then();
