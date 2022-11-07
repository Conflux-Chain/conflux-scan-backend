import {loadConfig} from "../../config/StatConfig";
import {saveAbiInfo} from "../../model/ContractInfo";
import { StatApp } from "../../StatApp";
import {createDB, initModel} from "../DBProvider";
import {ContractVerify} from "../../model/ContractVerify";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {Hex40Map} from "../../model/HexMap";
import {Op} from "sequelize";
import {ContractQuery} from "../ContractQuery";
import {EpochSync} from "../EpochSync";

const lodash = require('lodash');
const { format, sign } = require('js-conflux-sdk');

let type: number;
let cfx:Conflux;
let contractQuery: ContractQuery;
let base32;
let epochSync;

async function init() {
    const config = loadConfig('Prod')

    cfx = new Conflux(config.conflux);
    await cfx.updateNetworkId();
    patchHttpProvider(cfx, config.conflux);

    let seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)

    contractQuery = new ContractQuery({cfx});
    epochSync = new EpochSync({cfx});
}

async function parseVerified(base32) {
    const v = await ContractVerify.findOne({attributes: ['abi'], where: {base32, verifyResult: true}});
    const abi = JSON.parse(v.abi);
    await saveAbiInfo(abi);
    console.log(`generate abi info for ${base32}`);
}

async function addCodeHashForVerify() {
    const verifyArray = await ContractVerify.findAll({
        attributes: ['id', 'base32', 'codeHash'],
        where: {verifyResult: true},
        raw: true
    });

    for(const verify of verifyArray){
        if(!verify.codeHash){
            const code = await cfx.getCode(verify.base32);
            if(code === '0x'){
                console.log(`addCodeHashForVerify------base32:${verify.base32}:destroyed------code:${code}`);
                continue;
            }
            const codeHash = sign.keccak256(Buffer.from(code)).toString('hex');
            await ContractVerify.update({codeHash}, {where: {id: verify.id}});
            console.log(`addCodeHashForVerify------base32:${verify.base32}------codeLength:${code?.length}------codeHash:${codeHash}`);
        }
    }
    console.log(`addCodeHashForVerify------done!`);
}

async function addCodeHashForTrace() {
    const traceArray = await TraceCreateContract.findAll({
        attributes: ['id', 'to', 'codeHash'],
        raw: true
    });

    for(const trace of traceArray){
        if(!trace.codeHash){
            const hex40 = await Hex40Map.findOne({where: {id: trace.to}});
            const hex = `0x${hex40.hex}`;
            const base32 =  format.address(hex, StatApp.networkId);
            const code = await cfx.getCode(base32);
            if(code === '0x'){
                console.log(`addCodeHashForTrace------base32:${base32}:destroyed------code:${code}`);
                continue;
            }
            const codeHash = sign.keccak256(Buffer.from(code)).toString('hex');
            await TraceCreateContract.update({codeHash}, {where: {id: trace.id}});
            console.log(`addCodeHashForTrace------base32:${base32}------codeLength:${code?.length}------codeHash:${codeHash}`);
        }
    }
    console.log(`addCodeHashForTrace------done!`);
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
        const codeHash = sign.keccak256(Buffer.from(code)).toString('hex');

        const matchVerify = await ContractVerify.findOne({
            where: {codeHash, verifyResult: true},
            order: [['updatedAt', 'ASC']],
            raw: true
        });
        if(!matchVerify) {
            continue;
        }

        const matchRecord = lodash.assign(matchVerify, {id: undefined, base32, implementation: null});
        await ContractVerify.create(matchRecord);
        console.log(`addMatchedVerify------base32:${base32}------matchedContract:${matchVerify.base32}`);
    }
    console.log(`addMatchedVerify------done!`);
}

async function fixConstructorArgsForSimilarVerify() {
    const verifyArray = await ContractVerify.findAll({
        attributes: ['id', 'base32', 'similarMatch'],
        where: {verifyResult: true, similarMatch: {[Op.ne]: null}},
        raw: true
    });

    for(const verify of verifyArray){
        const similarVerify = await ContractVerify.findOne({
            attributes: ['id', 'base32', 'constructorArgs'],
            where: {base32: verify.similarMatch, verifyResult: true},
            raw: true
        });
        const bytecode = await contractQuery.exactBytecode({address: similarVerify.base32,
            constructorArgs: similarVerify.constructorArgs});
        const constructorArgs = await contractQuery.exactConstructorArgs({address: verify.base32, bytecode});

        await ContractVerify.update({constructorArgs}, {where: {id: verify.id}});
        console.log(`fixConstructorArgsForSimilarVerify------base32:${verify.base32}------constructorArgs:${constructorArgs?.length}`);
    }
    console.log(`fixConstructorArgsForSimilarVerify------done!`);
}

/*async function fixMinimalProxyContract() {
    const addressArray = [
        'net71:aacw3z94b49etazfs9suyyjtrk388s7d868nars6sm',
    ];
    for(const address of addressArray) {
        const implVerify = await ContractVerify.findOne({
            where: {base32: address, verifyResult: true},
            order: [['updatedAt', 'ASC']],
            raw: true
        });
        await contractQuery.verifyMinimalProxy({address, implVerifyId: implVerify.id});
    }
}*/

async function fixMinimalProxyContract() {
    const traceArray = await TraceCreateContract.findAll({
        attributes: ['id', 'to', 'codeHash'],
        raw: true
    });

    for(const trace of traceArray){
        const hex40 = await Hex40Map.findOne({where: {id: trace.to}});
        const address = `0x${hex40.hex}`;
        const isEIP1167 = await epochSync.verifyMinimalProxy({address});
        if(isEIP1167){
            console.log(`addCodeHashForTrace------address:${address}`);
        }
    }
    console.log(`addCodeHashForTrace------done!`);
}

async function run() {
    await init();
    if(type === 1){
        await addCodeHashForVerify();
    }
    if(type === 2){
        await addCodeHashForTrace();
    }
    if(type === 3){
        await addMatchedVerify();
    }
    if(type === 4) {
        await fixConstructorArgsForSimilarVerify();
    }
    if(type === 5) {
        await fixMinimalProxyContract();
    }
    if(type === 6) {
        await parseVerified(base32);
    }
}
const args = process.argv.slice(2)
StatApp.networkId = Number(args[0]);
type = Number(args[1]);
if(type === 6) {
 base32 = args[2];
}
run().then();
