import {loadConfig} from "../../config/StatConfig";
import {saveAbiInfo} from "../../model/ContractInfo";
import { StatApp } from "../../StatApp";
import {createDB, initModel} from "../DBProvider";
import {ContractVerify} from "../../model/ContractVerify";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {Hex40Map} from "../../model/HexMap";

const lodash = require('lodash');
const { format, sign } = require('js-conflux-sdk');

let type: number;
let cfx:Conflux;

async function init() {
    const config = loadConfig('Prod')

    cfx = new Conflux(config.conflux);
    await cfx.updateNetworkId();
    patchHttpProvider(cfx, config.conflux);

    let seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)
}

async function parseVerified() {
    const list = await ContractVerify.findAll({where: {verifyResult: true}})
    for (let i = 0; i < list.length; i++){
        let v = list[i];
        const abi = JSON.parse(v.abi)
        await saveAbiInfo(abi)
        console.log(`generate abi info for ${v.base32}`)
    }
}

async function addCodeHash() {
    const verifyArray = await ContractVerify.findAll({
        attributes: ['id', 'base32', 'getCodeHash'],
        where: {verifyResult: true},
        raw: true
    });

    for(const verify of verifyArray){
        if(!verify.getCodeHash){
            const code = await cfx.getCode(verify.base32);
            if(code === '0x'){
                continue;
            }
            const getCodeHash = sign.keccak256(Buffer.from(code)).toString('hex');
            await ContractVerify.update({getCodeHash}, {where: {id: verify.id}});
            console.log(`addCodeHash------base32:${verify.base32}------codeHash:${getCodeHash}`);
        }
    }
    console.log(`addCodeHash------done!`);
}

async function addMatchedVerify() {
    const traceCreateArray = await TraceCreateContract.findAll({
        attributes: ['id', 'to'],
        order: [['blockTime', 'ASC']],
        raw: true
    });

    for(const traceCreate of traceCreateArray){
        const toHex40Bean = await Hex40Map.findOne({where: {id: traceCreate.to}});
        if(!toHex40Bean){
            console.log(`addMatchedVerify------traceCreateId:${traceCreate.id}, toHex40Bean not exist!`);
            continue;
        }
        const base32 = format.address(`0x${toHex40Bean.hex}`, StatApp.networkId);

        const ownerVerify = await ContractVerify.findOne({
            where: {base32, verifyResult: true},
            order: [['updatedAt', 'ASC']],
            raw: true
        });
        if(ownerVerify){
            continue;
        }

        const code = await cfx.getCode(base32);
        if(code === '0x'){
            continue;
        }
        const getCodeHash = sign.keccak256(Buffer.from(code)).toString('hex');

        const matchVerify = await ContractVerify.findOne({
            where: {getCodeHash, verifyResult: true},
            order: [['updatedAt', 'ASC']],
            raw: true
        });
        if(!matchVerify) {
            continue;
        }

        const matchedBase32 = matchVerify.base32;
        const matchRecord = lodash.assign(matchVerify, {id: undefined, base32, bytecodeHash: null, implementation: null});
        await ContractVerify.create(matchRecord);
        console.log(`addMatchedVerify------base32:${base32}------matchedContract:${matchedBase32}`);
    }
    console.log(`addMatchedVerify------done!`);
}


async function run() {
    await init();
    if(type === 1){
        await addCodeHash();
    }
    if(type === 2){
        await addMatchedVerify();
    }
}
const args = process.argv.slice(2)
StatApp.networkId = Number(args[0]);
type = Number(args[1]);
run().then();