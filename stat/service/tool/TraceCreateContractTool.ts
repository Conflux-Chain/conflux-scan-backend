// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {Hex40Map, Hex64Map} from "../../model/HexMap";
import {ContractQuery} from "../ContractQuery";
import {ContractDestroy, TraceCreateContract} from "../../model/TraceCreateContract";
import {ContractVerify} from "../../model/ContractVerify";
import {TokenTool} from "./TokenTool";
import {Op} from "sequelize";
import { AddressTransactionIndex } from "../../model/FullBlock";
import {EpochSync} from "../EpochSync";
import {batchBlockDetail, initCfxSdk} from "../common/utils";
import {StatApp} from "../../StatApp";

const lodash = require('lodash');
const superagent = require('superagent');
const POSITION_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

const INTERNAL_ADMIN_CONTROL = '0x0888000000000000000000000000000000000000';
const SELECTOR_DESTROY = '0x00f55d9d';
const {abi: ABI_ADMIN_CONTROL} = require("../abi/AdminControl");

let seq;
let cfx;

let tokenTool;
let epochSync;
let contractQuery;

let type; // 1-block,2-transaction
let hash;
let epochNumber;
let minEpoch;
let maxEpoch;
let toFindHexAddress;

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)

    cfx = await initCfxSdk(config.conflux)
    StatApp.networkId = cfx.networkId;

    tokenTool = new TokenTool(cfx);

    const app = {cfx, networkId: StatApp.networkId, tokenTool};
    epochSync = new EpochSync(app);
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
    if(type === 3){
        // ---evm-main-net [36935000, 37087090)
        // ---evm-test-net [61465000, 66736900)
        // for(let curEpoch = minEpoch; curEpoch < maxEpoch; curEpoch++){
        //     const traceCreateArray = await epochSync.getTraceCreateArrayDB(curEpoch);
        //     if(traceCreateArray.length > 0){
        //         await TraceCreateContract.bulkCreate(traceCreateArray);
        //         for(const traceCreate of traceCreateArray){
        //             const hex40 = await Hex40Map.findOne({where: {id: traceCreate.to}});
        //             const address = `0x${hex40.hex}`;
        //             const codeHash = traceCreate.codeHash;
        //             await epochSync.linkVerify({address, codeHash});
        //         }
        //         console.log(`add trace create at epoch:${curEpoch}, traceCreateArray:${JSON.stringify(traceCreateArray)}`);
        //     }
        //     if(curEpoch % 1000 === 0){
        //         console.log(`add trace create catch up at epoch:${curEpoch}`);
        //     }
        // }

        // ---add trace create for verified contract
        // const base32Array = await ContractVerify.findAll({
        //     attributes: ['base32'],
        //     where: {verifyResult: true},
        //     raw: true
        // }).then(arr => arr.map(t => t.base32));
        // console.log(`base32Array.len------${base32Array?.length}`);
        //
        // let cntr = 0;
        // for(const base32 of base32Array){
        //     cntr = cntr + 1;
        //     const hex = format.hexAddress(base32);
        //     const hexBean = await Hex40Map.findOne({where: {hex: hex.substr(2)}});
        //     if(!hexBean) {
        //         console.log(`hex:${hex}[cntr=${cntr}]------hexBean not found`);
        //         continue;
        //     }
        //
        //     const hex40id = hexBean.id;
        //     const tx = await AddressTransactionIndex.findOne({
        //         attributes: ['epoch'],
        //         where: {addressId: hex40id, contractCreatedId: hex40id},
        //         raw: true
        //     });
        //     if(!tx) {
        //         console.log(`hex:${hex}[cntr=${cntr}]------tx not found`);
        //         continue;
        //     }
        //
        //     const targetEpoch = tx['epoch'];
        //     const traceCreateArrayDb = await TraceCreateContract.findAll({where : { epochNumber: targetEpoch}, raw: true});
        //     if(traceCreateArrayDb?.length > 0){
        //         console.log(`hex:${hex}[cntr=${cntr}]------already traced`);
        //         continue;
        //     }
        //
        //     const traceCreateArray = await epochSync.getTraceCreateArrayDB(tx['epoch']);
        //     if(traceCreateArray.length > 0) {
        //         await TraceCreateContract.bulkCreate(traceCreateArray);
        //     }
        //     console.log(`hex:${hex}[cntr=${cntr}]------processed`);
        // }

        // --- find trace create for specified address in epoch range
        for(let curEpoch = minEpoch; curEpoch < maxEpoch; curEpoch++){
            const traceCreateArray = await epochSync.getTraceCreateArrayDB(curEpoch);
            if(traceCreateArray.length > 0){
                for(const traceCreate of traceCreateArray){
                    const hex40 = await Hex40Map.findOne({where: {id: traceCreate.to}});
                    const address = `0x${hex40.hex}`;
                    if(toFindHexAddress === address){
                        await TraceCreateContract.bulkCreate(traceCreateArray);
                        console.log(`add trace create at epoch:${curEpoch} for address:${toFindHexAddress} finished`);
                        return;
                    }
                }
            }
            if(curEpoch % 1000 === 0){
                console.log(`add trace create catch up at epoch:${curEpoch}`);
            }
        }

        console.log(`done！`);
    }
    if(type === 4){
        await checkTraceCreate();
    }
    if(type === 5){
        await checkOZUnstructuredStorageProxy();
    }
    if(type === 6){
        const blockHashArray = await cfx.getBlocksByEpochNumber(epochNumber);
        const [blockArray, traceArray] = await batchBlockDetail(cfx, blockHashArray);
        console.log(`traceArray2d------:${JSON.stringify(traceArray)}`);
    }
    if(type === 7){
        await addTxHashForTraceCreate();
    }
    if(type === 8){
        await adminDestroyContract(minEpoch, maxEpoch);
    }
    if(type === 9){
        await getDataByEpochNumber();
    }
    if(type === 10) {
        const url = 'http://172.17.127.163:9527/open/account/crc721/transfers?account=cfx:aapwjebcay7d6jv02whjrrvkm9egmw5fye09cea6zz&from=cfx:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0sfbnjm2&skip=1000&limit=100&sort=DESC&withInput=false';
        const total = 100;
        let counter = total;
        let success = 0;
        let failure = 0;

        const start = Date.now();
        do{
            const response = await superagent.get(url)
                .timeout({response: 3 * 1000, deadline: 3 * 1000})
                .catch(() => undefined);

            counter = counter - 1;
            console.log(`counter------${counter}`);
        } while (counter > 0)
        const elapsed = Date.now() - start;

        console.log(`url------${url}`);
        console.log(`counter:${total}------QPS:${total/elapsed}`);
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
        const base32 = format.address(hex, StatApp.networkId);

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
    await epochSync.getTraceCreateArrayDB(epochNumber);
}

async function checkOZUnstructuredStorageProxy(){
    const addressIdArray = await Hex40Map.findAll({attributes: ['id'], where : { hex: {[Op.like]: `8%`}}, raw: true});
    const verifiedProxyAddressIdArray = [];
    const proxyAddressIdArray = [];
    for(const addressId of addressIdArray){
        const hex40 = await Hex40Map.findByPk(addressId.id);
        const hex40id = hex40.id;
        const hex = `0x${hex40.hex}`;
        const base32 = format.address(hex, StatApp.networkId);

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
                    implementation: format.address(`0x${implementationHex40.hex}`, StatApp.networkId),
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

async function addTxHashForTraceCreate(){
    const traceCreateArray = await TraceCreateContract.findAll({
        attributes: ['id', 'txHashId'],
        order: [['blockTime', 'ASC']],
        raw: true
    });

    for(const traceCreate of traceCreateArray) {
        const hex64Bean = await Hex64Map.findOne({where: {id: traceCreate.txHashId}});
        if(!hex64Bean){
            console.log(`addTxHashForTraceCreate------traceCreateId:${traceCreate.id}, hex64Bean not exist!`);
            continue;
        }
        await TraceCreateContract.update({txHash: hex64Bean.hex}, {where: {id: traceCreate.id}});
    }
}

async function adminDestroyContract(startEpochNumber, endEpochNumber){
    const adminControlHexBean = await Hex40Map.findOne({where:{hex: INTERNAL_ADMIN_CONTROL.substr(2)}});
    const addressTxArray = await AddressTransactionIndex.findAll({
        where: {
            addressId: adminControlHexBean.id,
            toId: adminControlHexBean.id,
            [Op.and]: [
                {epoch: {[Op.gte]: startEpochNumber}},
                {epoch: {[Op.lte]: endEpochNumber}},
            ],
        },
        order:[
            ['epoch', 'ASC'],
        ],
        logging: msg => console.log(`adminDestroyContract: ${msg}`),
    });

    const adminDestroyTxArray = [];
    for (const addressTx of addressTxArray){
        const transaction = await cfx.getTransactionByHash(addressTx.hash);
        const {hash, from, to, data, status} = transaction;
        if(status !== 0 || to === null) {
            continue;
        }

        const toHex = format.hexAddress(to);
        if(toHex === INTERNAL_ADMIN_CONTROL && data.substr(0, 10) === SELECTOR_DESTROY){
            const {timestamp: blockTime} = await epochSync.getEpoch(addressTx.epoch);
            const fromHex = format.hexAddress(from);
            const decodedData = epochSync.decodeData(ABI_ADMIN_CONTROL, data);
            const contract = decodedData.params[0].value;
            const destroyTx = {
                epochNumber: addressTx.epoch,
                blockTime,
                txHash: hash.substr(2),
                admin: fromHex.substr(2),
                contract: contract.substr(2),
            };
            adminDestroyTxArray.push(destroyTx);
        }
    }

    await ContractDestroy.bulkCreate(adminDestroyTxArray, {updateOnDuplicate:["epochNumber","blockTime","txHash","admin"],});
    console.log(`adminDestroyTxArray------${JSON.stringify(adminDestroyTxArray)}`);
    return adminDestroyTxArray;
}

async function getDataByEpochNumber(){
    for(let epochNumber = minEpoch; epochNumber <= maxEpoch; epochNumber++){
        const epoch = await epochSync.getEpoch(epochNumber);
        console.log(`epoch------${epoch}`)
        const epochTimestamp = epoch.timestamp;
        const {blockHashArray, blockArray} = await epochSync.getMinerBlockArray(epochNumber);
        console.log(`blockHashArray------${JSON.stringify(blockHashArray)}`)
        console.log(`blockArray------${JSON.stringify(blockArray)}`)
        const eventLogInfo = await epochSync.getLogsGrouped({epochNumber, epochTimestamp});
        console.log(`eventLogInfo------${JSON.stringify(eventLogInfo)}`)
        const traceArray = await epochSync.getTraceArray(epochNumber);
        console.log(`traceArray------${JSON.stringify(traceArray)}`)

        const addrTransferArray = await epochSync.getAddrTransferArrayDB(epochNumber, epochTimestamp, blockHashArray,
            blockArray, eventLogInfo, traceArray);
        console.log(`addrTransferArray------${JSON.stringify(addrTransferArray)}`)
        if(addrTransferArray?.length){
            // await AddressTransfer.bulkCreate(addrTransferArray);
        }

        if(epochNumber % 1000 === 0){
            console.log(`add address transfer catch up at epoch:${epochNumber}`);
        }
    }
}


const args = process.argv.slice(2);
StatApp.networkId = Number(args[0]);
if(args[1]){
    type = Number(args[1]);
}
if((type === 1 || type === 2) && args[2]){
    hash = args[2];
}
if(type === 3 && args[2] && args[3]){
    minEpoch = Number(args[2]);
    maxEpoch = Number(args[3]);
    toFindHexAddress = args[4];
}
if(type === 6 && args[2]){
    epochNumber = Number(args[2]);
}
if(type === 8 && args[2] && args[3]){
    minEpoch = Number(args[2]);
    maxEpoch = Number(args[3]);
}
if(type === 9 && args[2] && args[3]){
    minEpoch = Number(args[2]);
    maxEpoch = Number(args[3]);
}

console.log(`params======networkId:${StatApp.networkId}======type:${type}======minEpoch:${minEpoch}======maxEpoch:${maxEpoch}======toFindHexAddress:${toFindHexAddress}`);
run().then();
