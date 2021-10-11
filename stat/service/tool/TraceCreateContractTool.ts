import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {Hex40Map} from "../../model/HexMap";
import {BlockTraceCreateSync} from "../BlockTraceCreateSync";
import {ContractQuery} from "../ContractQuery";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {ContractVerify} from "../../model/ContractVerify";
// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {TokenTool} from "./TokenTool";
import {Op} from "sequelize";
import {
    AddressTransactionIndex,
} from "../../model/FullBlock";
import {TokenQuery} from "../TokenQuery";

const lodash = require('lodash');
const POSITION_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

let seq;
let cfx;
let networkId;
let tokenTool;
let type; // 1-block,2-transaction
let hash;
let epochNumber;
let service;
let contractQuery;

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)

    cfx = new Conflux({...config.conflux})
    tokenTool = new TokenTool(cfx);
    service = new BlockTraceCreateSync(cfx);

    const app = {cfx};
    contractQuery = new ContractQuery(app);
}

async function close(){
    Hex40Map.sequelize.close().then();
}

async function run() {
    await init();

    let result;
    if(type === 1){
        result = await cfx.traceBlock(hash);
    }
    if(type === 2) {
        result = await cfx.traceTransaction(hash);
    }
    if(type === 3){//epoch=41696044
        await service.syncByEpoch(epochNumber);
    }
    if(type === 4){
        await checkTraceCreate();
    }
    if(type === 5){
        await checkOZUnstructuredStorageProxy();
    }

    console.log(`trace by hash completed...\ntype:${type}\nhash:${hash}\ntrace:${JSON.stringify(result)}`);
    await close();
}

async function checkTraceCreate(){
    const addressIdArray = await Hex40Map.findAll({attributes: ['id'], where : { hex: {[Op.like]: `8%`}}, raw: true});
    const lostAddressIdArray = [];
    const verifiedButNotDeployed = [];
    for(const addressId of addressIdArray){
        const hex40 = await Hex40Map.findByPk(addressId.id);
        const hex40id = hex40.id;
        const hex = `0x${hex40.hex}`;
        const base32 = format.address(hex, networkId);

        let deployedByteCode;
        try {
            deployedByteCode = await cfx.getCode(base32);
        } catch (e) {
        }
        if(deployedByteCode === '0x' || deployedByteCode === undefined){
            const verify = await ContractVerify.findOne({where: {base32, verifyResult: true}});
            if(verify) verifiedButNotDeployed.push(hex40id);
            continue;
        }

        const traceCreate = await TraceCreateContract.findOne({where : { to: hex40id}, raw: true});
        if(traceCreate === null){
            await getTraceCreate(hex40id, base32);
            const traceCreateOnSecondTime = await TraceCreateContract.findOne({where : { to: hex40id}, raw: true});
            if(traceCreateOnSecondTime === null) {
                lostAddressIdArray.push(hex40id);
                console.log(`lost trace create: hex40id:${hex40id}, hex40:${hex}`);
            }
        }
    }
    console.log(`lost trace create: lostAddressIdArray:${JSON.stringify(lostAddressIdArray)}, verifiedButNotDeployed:${JSON.stringify(verifiedButNotDeployed)}`);
}

async function getTraceCreate(hex40id, base32){
    // 1. 获得 contract的 admin
    const admin = await cfx.getAdmin(base32);
    // 2. 从address_tx表中获得 admin的 transaction list
    const adminHex = format.hexAddress(admin);
    if(adminHex === '0x0000000000000000000000000000000000000000'){
        return;
    }
    const adminHexBean = await Hex40Map.findOne({where:{hex: adminHex.substr(2)}})
    const adminHex40id = adminHexBean.id;
    const txList = await AddressTransactionIndex.findAll({raw: true, where: {addressId: adminHex40id}});
    // 3. 遍历交易列表， 过滤出 contractCreatedId = hex40id的交易记录
    const txArray = txList?.filter(tx => tx.contractCreatedId === hex40id);
    const tx = txArray?.length ? txArray[0] : undefined;
    if(tx === undefined){
        return;
    }
    // 4. 根据epochNumber同步trace_create_contract记录，并入库
    const epochNumber = tx.epoch;
    await service.syncByEpoch(epochNumber);
}

async function checkOZUnstructuredStorageProxy(){
    const addressIdArray = await Hex40Map.findAll({attributes: ['id'], where : { hex: {[Op.like]: `8%`}}, raw: true});
    const verifiedProxyAddressIdArray = [];
    const proxyAddressIdArray = [];
    for(const addressId of addressIdArray){
        const hex40 = await Hex40Map.findByPk(addressId.id);
        const hex40id = hex40.id;
        const hex = `0x${hex40.hex}`;
        const base32 = format.address(hex, networkId);

        const implementation = await cfx.getStorageAt(base32, POSITION_IMPLEMENTATION_SLOT);
        if(implementation === null){
            continue;
        }

        const implementationHex40 = await Hex40Map.findOne({where: {hex: implementation.substr(26)}, raw: true});
        if(implementationHex40 !== null){
            // ===>add proxy info for base32 if it has already verified
            let dbVerify = await ContractVerify.findOne({where: {base32, verifyResult: true}, raw: true});
            if(dbVerify !== null){
                let updateVerify = lodash.assign(dbVerify, {
                    proxy: true,
                    implementation: format.address(`0x${implementationHex40.hex}`, networkId),
                    proxyPattern: "OpenZeppelin's Unstructured Storage",
                    updatedAt: new Date()
                });
                const result = await ContractVerify.update(updateVerify, {where: {id: dbVerify.id}});
                verifiedProxyAddressIdArray.push(hex40id);
                console.log(`proxy:${base32}, implementation:${implementation}, updateVerifyResult:${JSON.stringify(result)}`);
            }
            // add proxy info for base32 if it has already verified<===
            proxyAddressIdArray.push(hex40id);
            console.log(`proxy:${base32}, implementation:${implementation}`);
        }
    }
    console.log(`cntr:${proxyAddressIdArray.length},
    proxyAddressIdArray:${JSON.stringify(proxyAddressIdArray)},
    verifiedCntr:${verifiedProxyAddressIdArray.length},
    verifiedProxyAddressIdArray:${JSON.stringify(verifiedProxyAddressIdArray)}`);
}


const args = process.argv.slice(2);
networkId = Number(args[0]);
if(args[1]){
    type = Number(args[1]);
}
if((type === 1 || type === 2) && args[2]){
    hash = args[2];
}
if(type === 3 && args[2]){
    epochNumber = Number(args[2]);
}

console.log(`params======networkId:${networkId}======type:${type}======hash:${hash}`);
run().then();
