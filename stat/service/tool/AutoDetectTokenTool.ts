import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {Hex40Map} from "../../model/HexMap";
// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {TokenTool} from "./TokenTool";
const lodash = require('lodash');

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
    const traceCreate = await TraceCreateContract.findOne({where: {id} });
    if (traceCreate === null) {
        return;
    }

    const hex40 = await Hex40Map.findByPk(traceCreate.to)
    const hex = `0x${hex40.hex}`;
    const base32 = format.address(hex, networkId);
    const[isCrc721, isCrc1155] = await Promise.all([
        tokenTool.supportsInterface(base32, interfaceIdCrc721),
        tokenTool.supportsInterface(base32, interfaceIdCrc1155)
    ]);

    let tokenType;
    if(isCrc721 === true){
        tokenType = 'CRC721';
    }
    if(isCrc1155 === true){
        tokenType = 'CRC1155';
    }
    if(tokenType === undefined){
        return;
    }

    const totalSupply = await tokenTool.getTokenTotalSupply(base32);
    const tokenInfo = await tokenTool.getToken(base32);
    const token = lodash.defaults({}, tokenInfo, {totalSupply}, {type: tokenType});
    return token;
}

async function close(){
    Hex40Map.sequelize.close().then();
}

async function run(round = 10) {
    await init();
    let minId:number = await TraceCreateContract.min('id');
    let maxId:number = await TraceCreateContract.max('id');
    console.log(`round:${round}\n minId:${minId}\n maxId:${maxId}`);
    let roundCounter = 0
    const nft721TokenArray = [];
    const nft1155TokenArray = [];
    while (roundCounter < round && minId<=maxId) {
        const token = await detect(minId++);
        if(token === undefined){
            continue;
        }
        if(token.type === 'CRC721'){
            nft721TokenArray.push(token);
            console.log(`CRC721:${JSON.stringify(token)}\n`);
        }
        if(token.type === 'CRC1155'){
            nft1155TokenArray.push(token);
            console.log(`CRC1155:${JSON.stringify(token)}\n`);
        }
        roundCounter++
    }
    await close();
    console.log(`nft721TokenArray:${nft721TokenArray.length}\n nft1155TokenArray:${nft1155TokenArray.length}`);
}

const args = process.argv.slice(2);
networkId = Number(args[0]);
if(args[1]){
    round = Number(args[1]);
}

run(round).then();
