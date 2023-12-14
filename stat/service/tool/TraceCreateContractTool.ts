// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {Hex40Map, Hex64Map} from "../../model/HexMap";
import {ContractQuery} from "../ContractQuery";
import {ContractDestroy, TraceCreateContract} from "../../model/TraceCreateContract";
import {ContractVerify} from "../../model/ContractVerify";
import {TokenTool} from "./TokenTool";
import {Op, where} from "sequelize";
import {AddressTransactionIndex, FullTransaction} from "../../model/FullBlock";
import {EpochSync} from "../EpochSync";
import {batchBlockDetail, batchFetchBlock, initCfxSdk} from "../common/utils";
import {StatApp} from "../../StatApp";
import {EpochNftTransferSync} from "../EpochNftTransferSync";
import {sleep} from "./ProcessTool";
import {AddressTransfer} from "../../model/AddrTransfer";
import {CONST} from "../common/constant";
import {KV} from "../../model/KV";
import {Epoch, EpochNftTransfer} from "../../model/Epoch";
import {Token} from "../../model/Token";
import {SyncCode, SyncData} from "../SyncBase";
import {decodeTransferFromReceipts} from "../../TokenTransferSync";
import {PruneNotifier} from "../prune/PruneNotifier";
import {PruneType} from "../../model/PruneInfo";
import {boolean} from "js-conflux-sdk/dist/types/util/format";

const lodash = require('lodash');
const superagent = require('superagent');
const path = require('path')
const fs = require('fs')
const mineType = require("mime-types");
const request = require("request");

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
let store;
let toFindHexAddress;
let contractId;
let loop;

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)

    cfx = await initCfxSdk(config.conflux)
    StatApp.networkId = cfx.networkId;

    tokenTool = new TokenTool(cfx);

    const app = {cfx, networkId: StatApp.networkId, tokenTool, config};
    epochSync = new EpochSync(app);
    // epochSync = new EpochNftTransferSync(app);
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
        await getDataByEpochNumber(minEpoch);
    }
    if(type === 10) {
        await getDataByEpochNumberForNft()
    }
    if(type === 11) {
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
    if(type === 12) {
        let epochNumber = minEpoch;
        do{
            const blockArray = await getNotExecutedTransaction(epochNumber);
            if(blockArray) {
                console.log(`blockArray ${JSON.stringify(blockArray)}`);
                return;
            }
            epochNumber = epochNumber + 1
        } while (true);
    }
    if(type === 13) {
        await addContractCreatedForAddressTransfer(contractId)
    }
    if(type === 14) {
        await updateCursorForAddressTransfer(loop)
    }
    if(type === 15) {
        await clearEpochNftTransferBeforeFinalized(epochNumber);
    }
    if(type === 16){
        await fixIconUrl();
    }
    if(type === 17) {
        await updateIconUrl()
    }
    if(type === 18){
        await updateTxPositionForAddressTransfer(loop)
    }
    if(type === 19) {
        await updateCursorForAddressTransferTs(loop)
    }

    console.log(`type:${type} hash:${hash} trace:${JSON.stringify(result)}`);
    await close();
}

async function getNotExecutedTransaction(epochNumber) {
    const blockHashArray = await cfx.getBlocksByEpochNumber(epochNumber);
    const blockArray = await batchFetchBlock(cfx,  blockHashArray);
    for (const block of blockArray) {
        const transactionArray = block?.transactions || [];
        for (const transaction of transactionArray) {
            if(transaction?.status === null) {
                return blockArray;
            }
        }
    }
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

async function addContractCreatedForAddressTransfer(contractId){
    const options: any = {
        raw: true
    }
    if(contractId) {
        options.where = {to: contractId}
    }
    const traceCreateArray = await TraceCreateContract.findAll(options);

    const result = {
        case1Contracts: new Set(),
        case2Contracts: new Set(),
        case3Contracts: new Set(),
        case4Contracts: new Set(),
        shouldNeverHappen: new Set(),
    }

    for(const trace of traceCreateArray) {
        // get trace
        const {txHash, from, to, value } = trace

        // get tx
        const tx = await FullTransaction.findOne({where: {hash: `0x${txHash}`}});
        if(!tx){
            console.log(`tx ${hash} not exist!`);
            continue;
        }
        const {epoch, blockPosition: blockIndex, txPosition: txIndex} = tx;

        // update contract created
        await updateContractCreated(from, to, value, epoch, blockIndex, txIndex, result)
    }

    console.log(`addContractCreatedForAddressTransfer\n  
    case1Contracts:${JSON.stringify([...result.case1Contracts].length)}\n 
    case2Contracts:${JSON.stringify([...result.case2Contracts].length)}\n  
    case3Contracts:${JSON.stringify([...result.case3Contracts].length)}\n 
    case4Contracts:${JSON.stringify([...result.case4Contracts].length)}\n 
    shouldNeverHappen:${JSON.stringify([...result.shouldNeverHappen])}`)
}

// case1: create  and value = 0, tx
// case2: create  and value > 0, tx and cfx transfer
// case3: create2 and value = 0, nothing
// case4: create2 and value > 0, cfx transfer
enum CaseType {
    case1 = 1,
    case2,
    case3,
    case4
}

async function updateContractCreated(fromId, contractId, value, epoch, blockIndex, txIndex, result) {
    const {ADDRESS_TRANSFER_TYPE: {TX, CFX_IN_CREATE}} = CONST;
    const addressIds = [contractId, fromId]

    let lastCaseType;
    for (const addressId of addressIds) {
        if (lastCaseType && lastCaseType === CaseType.case3) { // For contract created by op code `create2` and value = 0, no need to process `from`.
            continue;
        }

        const tag = addressId !== contractId ? 'from' : 'to'
        const transfers = await AddressTransfer.findAll({where: {addressId, epoch, blockIndex, txIndex, type: {[Op.in]: [TX.code, CFX_IN_CREATE.code]}}})

        if (!transfers?.length) {
            if (lastCaseType && lastCaseType !== CaseType.case3) {
                // result.shouldNeverHappen.add({tag, fromId, contractId, lastCaseType, caseType: CaseType.case3}) // For contract created by op code `create`, and from's transfer(type=tx) has been truncated already.
                continue;
            }
            lastCaseType = CaseType.case3
            result.case3Contracts.add(contractId)
            // console.log(`case3(create2 & value = 0): ${tag} ${addressId} no transfer, value ${value}, contractId ${contractId}`);
            continue;
        }

        if (transfers?.length > 1) {
            if (lastCaseType && lastCaseType !== CaseType.case2) {
                result.shouldNeverHappen.add({tag, fromId, contractId, lastCaseType, caseType: CaseType.case2})
                continue;
            }
            lastCaseType = CaseType.case2
            result.case2Contracts.add(contractId)
            for (const t of transfers) {
                await AddressTransfer.update({contractId}, {where: {addressId, epoch, blockIndex, txIndex, txLogIndex: t.txLogIndex, batchIndex: t.batchIndex, type: t.type}});
            }
            // console.log(`case2(create & value > 0): ${tag} ${addressId} ${transfers?.length} transfer, value ${value}, contractId ${contractId}`);
            continue;
        }

        const transfer = transfers[0]
        const type = transfer.type
        if (type === TX.code) {
            if (lastCaseType && lastCaseType !== CaseType.case1) {
                result.shouldNeverHappen.add({tag, fromId, contractId, lastCaseType, caseType: CaseType.case1})
                continue;
            }
            lastCaseType = CaseType.case1
            result.case1Contracts.add(contractId)
            // console.log(`case1(create & value = 0): ${tag} ${addressId} 1 transfer, value ${value}, contractId ${contractId}`);
        }
        if (type === CFX_IN_CREATE.code) {
            if (lastCaseType && lastCaseType !== CaseType.case4) {
                result.shouldNeverHappen.add({tag, fromId, contractId, lastCaseType, caseType: CaseType.case4})
                continue;
            }
            lastCaseType = CaseType.case4
            result.case4Contracts.add(contractId)
            // console.log(`case4(create2 & value > 0): ${tag} ${addressId} 1 transfer, value ${value}, contractId ${contractId}`);
        }
        await AddressTransfer.update({contractId}, {where: {addressId, epoch, blockIndex, txIndex, type}});
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

async function getDataByEpochNumber(epochNumber){
    const epochData = await epochSync.getEpochData(epochNumber);
    const {epoch, blockHashArray, blockArray, receipts} = epochData;
    const epochTimestamp = epoch.timestamp;

    const traceArray = await epochSync.getTraceArray(epochNumber);

    const {t20, t721, t1155} = decodeTransferFromReceipts(receipts, tokenTool, epochTimestamp, blockHashArray);
    const tokenLogs = {transfer20Array: t20, transfer721Array: t721, transfer1155Array: t1155};
    const tokenTransferArray = await epochSync.getTokenTransferArrayDB(epochTimestamp, blockHashArray, tokenLogs, true);
    const cfxTransferArray = await epochSync.getCFXTransferArrayDB(epochTimestamp, blockHashArray, traceArray);
    const txArray = await EpochSync.getAddrTxArray(blockArray, epochTimestamp);
    const addrTransferArray = await epochSync.getAddrTransferArrayDB(epochNumber, 0, tokenTransferArray, cfxTransferArray,
        txArray);

    return  addrTransferArray;
}

async function getDataByEpochNumberForNft(){
    for(let epochNumber = minEpoch; epochNumber <= maxEpoch; epochNumber++){
        const data = await epochSync.getData(epochNumber);
        // console.log(`data ${JSON.stringify(data)}`)
        if(store) {
            await epochSync.save(epochNumber, data.modelData);
            // console.log(`store done!`)
        }
    }
}

const keyMax = 'max_epoch_address_transfer';
const keyCur = 'cur_epoch_address_transfer';

async function updateCursorForAddressTransfer(loop) {
    const maxEpoch = await KV.getNumber(keyMax);
    if(!maxEpoch) {
        console.log(`max epoch not exist`)
        return
    }

    const curEpoch = await KV.getNumber(keyCur);
    let nextEpoch = curEpoch ? curEpoch + 1 : (await AddressTransfer.min('epoch')) as number

    let cntr = 1
    while(true) {
        const transferArray = await AddressTransfer.findAll({where: {epoch: nextEpoch}, raw: true})
        if(transferArray?.length) {
            for (const t of transferArray) {
                const {addressId, epoch, blockIndex, txIndex, txLogIndex, batchIndex, type} = t
                const cursorId = EpochSync.buildAddrTransferCursor(t)
                await AddressTransfer.update({cursorId} as any, {where:{addressId, epoch, blockIndex, txIndex, txLogIndex, batchIndex, type}})
            }
        }
        await KV.upsert({key: keyCur, value: nextEpoch.toString()})

        nextEpoch = nextEpoch + 1
        if(nextEpoch > maxEpoch) {
            break
        }

        cntr = cntr + 1
        if(loop && cntr > loop) {
            break
        }

        if(nextEpoch % 1000 === 0) {
            console.log(`padding address transfer's cursor at epoch ${nextEpoch}`)
        }
        await sleep(3)
    }
}

const keyMax2 = 'max_epoch_address_transfer_2';
const keyCur2 = 'cur_epoch_address_transfer_2';
async function updateCursorForAddressTransferTs(loop) {
    const maxEpoch = await KV.getNumber(keyMax2);
    if(!maxEpoch) {
        console.log(`max epoch not exist`)
        return
    }

    const curEpoch = await KV.getNumber(keyCur2);
    let nextEpoch = curEpoch ? curEpoch + 1 : (await AddressTransfer.min('epoch')) as number

    let cntr = 0
    while(true) {
        const transferArray = await AddressTransfer.findAll({where: {epoch: nextEpoch}, raw: true})
        if(transferArray?.length) {
            const txMap = {}
            const tsCfxMap = []
            const ts20Map = []
            const ts721Map = []
            const ts1155Map = []
            for (const t of transferArray) {
                const {blockIndex, txIndex, txLogIndex} = t;
                const key = `${blockIndex}-${txIndex}-${txLogIndex}`;
                if(t.type === CONST.ADDRESS_TRANSFER_TYPE.TX.code) {
                    txMap[key] = {blockIndex, txIndex, txLogIndex}
                }
                if(t.type >= CONST.ADDRESS_TRANSFER_TYPE.CFX_IN_CALL.code && t.type <= CONST.ADDRESS_TRANSFER_TYPE.CFX_IN_INTERNAL_BY_BALANCE.code) {
                    tsCfxMap[key] = {blockIndex, txIndex, txLogIndex}
                }
                if(t.type === CONST.ADDRESS_TRANSFER_TYPE.ERC20.code) {
                    ts20Map[key] = {blockIndex, txIndex, txLogIndex}
                }
                if(t.type === CONST.ADDRESS_TRANSFER_TYPE.ERC721.code) {
                    ts721Map[key] = {blockIndex, txIndex, txLogIndex}
                }
                if(t.type === CONST.ADDRESS_TRANSFER_TYPE.ERC1155.code) {
                    ts1155Map[key] = {blockIndex, txIndex, txLogIndex}
                }
            }

            const txArray = lodash.orderBy([...Object.values(txMap)], ['blockIndex', 'txIndex', 'txLogIndex'], ['asc', 'asc', 'asc'])
            const tsCfxArray = lodash.orderBy([...Object.values(tsCfxMap)], ['blockIndex', 'txIndex', 'txLogIndex'], ['asc', 'asc', 'asc'])
            const ts20Array = lodash.orderBy([...Object.values(ts20Map)], ['blockIndex', 'txIndex', 'txLogIndex'], ['asc', 'asc', 'asc'])
            const ts721Array = lodash.orderBy([...Object.values(ts721Map)], ['blockIndex', 'txIndex', 'txLogIndex'], ['asc', 'asc', 'asc'])
            const ts1155Array = lodash.orderBy([...Object.values(ts1155Map)], ['blockIndex', 'txIndex', 'txLogIndex'], ['asc', 'asc', 'asc'])

            const txMap1 = {}
            const tsCfxMap1 = []
            const ts20Map1 = []
            const ts721Map1 = []
            const ts1155Map1 = []
            let index = 0;
            for (const t of txArray) {
                txMap1[`${t.blockIndex}-${t.txIndex}-${t.txLogIndex}`] = index++;
            }
            for (const t of tsCfxArray) {
                tsCfxMap1[`${t.blockIndex}-${t.txIndex}-${t.txLogIndex}`] = index++;
            }
            for (const t of ts20Array) {
                ts20Map1[`${t.blockIndex}-${t.txIndex}-${t.txLogIndex}`] = index++;
            }
            for (const t of ts721Array) {
                ts721Map1[`${t.blockIndex}-${t.txIndex}-${t.txLogIndex}`] = index++;
            }
            for (const t of ts1155Array) {
                ts1155Map1[`${t.blockIndex}-${t.txIndex}-${t.txLogIndex}`] = index++;
            }

            const epoch = await Epoch.findOne({where:{epoch: nextEpoch}});
            const timeStamp = epoch.timestamp.getTime()/1000;
            for (const t of transferArray) {
                const {addressId, epoch, blockIndex, txIndex, txLogIndex, batchIndex, type} = t
                let index = 0
                if(type === CONST.ADDRESS_TRANSFER_TYPE.TX.code) {
                    index = txMap1[`${t.blockIndex}-${t.txIndex}-${t.txLogIndex}`]
                }
                if(type >= CONST.ADDRESS_TRANSFER_TYPE.CFX_IN_CALL.code && type <= CONST.ADDRESS_TRANSFER_TYPE.CFX_IN_INTERNAL_BY_BALANCE.code) {
                    index = tsCfxMap1[`${t.blockIndex}-${t.txIndex}-${t.txLogIndex}`]
                }
                if(type === CONST.ADDRESS_TRANSFER_TYPE.ERC20.code) {
                    index = ts20Map1[`${t.blockIndex}-${t.txIndex}-${t.txLogIndex}`]
                }
                if(type === CONST.ADDRESS_TRANSFER_TYPE.ERC721.code) {
                    index = ts721Map1[`${t.blockIndex}-${t.txIndex}-${t.txLogIndex}`]
                }
                if(type === CONST.ADDRESS_TRANSFER_TYPE.ERC1155.code) {
                    index = ts1155Map1[`${t.blockIndex}-${t.txIndex}-${t.txLogIndex}`]
                }
                const cursorId = EpochSync.buildAddrTransferCursorTs(nextEpoch, index);
                await AddressTransfer.update({cursorId} as any, {where:{addressId, epoch, blockIndex, txIndex, txLogIndex, batchIndex, type}})
            }
        }
        await KV.upsert({key: keyCur2, value: nextEpoch.toString()})

        nextEpoch = nextEpoch + 1
        if(nextEpoch > maxEpoch) {
            break
        }

        cntr = cntr + 1
        if(loop && cntr >= loop) {
            break
        }

        if(nextEpoch % 1000 === 0) {
            console.log(`padding address transfer's ts cursor at epoch ${nextEpoch}`)
        }
        await sleep(3)
    }
    console.log(`padding address transfer's ts cursor done!`)
}

const keyEpochMax = 'max_epoch_tx_pos_addr_ts';
const keyEpochCur = 'cur_epoch_tx_pos_addr_ts';

async function updateTxPositionForAddressTransfer(loop) {
    const maxEpoch = await KV.getNumber(keyEpochMax);
    if(!maxEpoch) {
        console.log(`max epoch not exist`)
        return
    }

    const curEpoch = await KV.getNumber(keyEpochCur);
    let nextEpoch = curEpoch ? curEpoch + 1 : (await AddressTransfer.min('epoch')) as number

    let cntr = 1
    while(true) {
        const tsArray = await AddressTransfer.findAll({where: {epoch: nextEpoch}, raw: true})
        const uniqueTxs: string[] = []
        if(tsArray?.length) {
            uniqueTxs.push(...new Set<string>(tsArray.map(ts => (`${ts.epoch}_${ts.blockIndex}_${ts.txIndex}`))))
        }

        const fullTxs = await FullTransaction.findAll({where: {epoch: nextEpoch}, raw: true})
        const uniqueFullTxs: string[] = []
        if(fullTxs?.length) {
            uniqueFullTxs.push(...new Set<string>(fullTxs.map(tx => (`${tx.epoch}_${tx.blockPosition}_${tx.txPosition}`))))
        }

        if(!checkTxPositionConsistency(uniqueTxs, uniqueFullTxs)) {
            let tsArrayNew
            try{
                tsArrayNew = await getDataByEpochNumber(nextEpoch)
            } catch (e){
                console.log(`Epoch ${nextEpoch} rpc err`, e)
                await sleep(3)
                continue
            }
            const uniqueTxsNew: string[] = []
            if(tsArrayNew?.length) {
                uniqueTxsNew.push(...new Set<string>(tsArrayNew.map(ts => (`${ts.epoch}_${ts.blockIndex}_${ts.txIndex}`))))
            }
            if(!checkTxPositionConsistency(uniqueTxsNew, uniqueFullTxs)){
                console.log(`Epoch ${nextEpoch} need to be checked manually`)
                continue;
            }
            // console.log(`Fixed nextEpoch ${nextEpoch} tsArrayNew ${JSON.stringify(tsArrayNew)}`)
            await AddressTransfer.destroy({where: {epoch: nextEpoch}})
            await AddressTransfer.bulkCreate(tsArrayNew);
        }


        await KV.upsert({key: keyEpochCur, value: nextEpoch.toString()})

        nextEpoch = nextEpoch + 1
        if(nextEpoch > maxEpoch) {
            break
        }

        cntr = cntr + 1
        if(loop && cntr > loop) {
            break
        }

        if(nextEpoch % 1000 === 0) {
            console.log(`fix address transfer's tx position at epoch ${nextEpoch}`)
        }
        await sleep(3)
    }
}

function checkTxPositionConsistency(uniqueTxs: string[], uniqueFullTxs: string[]): boolean {
    if(uniqueTxs.length !== uniqueFullTxs.length) {
        return false;
    }

    const interTxs = lodash.intersection(uniqueTxs, uniqueFullTxs)
    if(interTxs?.length !== uniqueTxs.length) {
        return false;
    }

    return true;
}

const iconUrls = [
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aac56pemfkgmryyc09fcuyrdu64z10kc5auef9d0btb.png',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aacxuz42mf8s2dy71n3jhg36vujs5rx5jj2027cbp4v.png',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aadd0sef1ajt7djpedbh5sj5hj2ggufreguhfm2u83u.png',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aad5t0vsucen597s2v7shuvpg1z09dfj0xaxfaentwe.png',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aaajepb26n5pshbjc1usr43jzdtxezw62ku779rfb1z.png',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aactf6u7p82ypcx2xw8jxmbunvdnnywbkyu6y3wybdg.jpeg',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aacnjc648dtgar8n6y8x4n5zutfj5e0fdh6ej03mu3r.png',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aabk8wdr9985xkxd4gc2p1c45xs1747rd2jtt23n1zf.jpeg',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aacwrztpt4dw1mc421jb7jkdrg0d4k777s6uts30hus.png',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aact43d3yjp9d90js35zw2d146jaeg72f5jwtwwjs9k.jpeg',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aacj3ba21yfcf9h2wecezey3zvdvy46namutunvh0rp.png',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aaan08u83zady2yypwhdjyr76b3srs2fjhe6rnsxwz4.jpeg',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aadv28pnes792dhjjjcsntn7rfk3t1m2dsjkvsp7pu9.jpeg',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aac7n2vuw1pdubhgyhswbtx8y6as3dtcf42f591w472.png',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aabadzdw6b3nuvxpxb95avn53xktx9r6eeu7f3psgrc.jpeg',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aacfesxknt40p8xc15smrm0bhf2cj9gngd2usu2sf0c.jpeg',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aadhjy7bn9ykdpuu2rhksgmv25ukm1wv3pyg3j8ef9g.png',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aackbrxzmm38c24yh8r2wunk51r5rbb40yj8vwd2m4n.png',
    'https://scan-icons.oss-cn-hongkong.aliyuncs.com/mainnet/net1030%3Aadtetkckjm8px2rsu8e87zxzu6vf2a0r2j5ke7g9up.png',
];
const dstDir = path.join(__dirname+'/saveImg')

async function fixIconUrl() {
    for (const iconUrl of iconUrls) {
        downloadImg(iconUrl, dstDir)
    }
}

async function updateIconUrl() {
    for (const iconUrl of iconUrls) {
        const fileName = iconUrl.split('/').pop();
        console.log(`fileName ${fileName}`)
        const base64Data = imgToBase64(`${dstDir}/${fileName}`);
        console.log(`base64Data ${base64Data.length}`)
        const base32 = (decodeURIComponent(fileName)).split('.').shift();
        console.log(`base32 ${base32}`)
        const [effectRows] = await Token.update({icon: base64Data}, {where: {base32}});
        if(effectRows) {
            console.log(`${fileName} updated success!`);
        } else{
            console.log(`${fileName} updated fail!`);
        }
    }
}

function downloadImg(srcUrl, dstDir) {
    if (!fs.existsSync(dstDir)) {
        fs.mkdirSync(dstDir, { recursive: true });
    }

    const fileName = srcUrl.split('/').pop();

    const process = fs.createWriteStream( `${dstDir}/${fileName}`);

    request({
        url: srcUrl,
        timeout: 5000
    }).pipe(process);

    process.on('finish', async () => {
        console.log(`${fileName} download success!`);
    })
    process.on('error', err => {
        console.log(`${fileName} download fail!`, err);
    })

    return fileName;
}

function imgToBase64(file) {
    let filePath = path.resolve(file);
    const fileName = filePath.split('/').pop();
    let fileMimeType = mineType.lookup(filePath);

    if(!fileMimeType.toString().includes('image')) {
        console.log(`Failed! ${filePath}:\tNot image file!`);
        return;
    }

    const imageData = fs.readFileSync(filePath);
    if (!imageData) {
        console.log(`Failed! No imageData!`)
        return;
    }
    const base64Data = Buffer.from(imageData).toString('base64');

    return `data:${fileMimeType};base64,${base64Data}`;
}

async function clearEpochNftTransferBeforeFinalized(finalizedEpoch) {
    while(true) {
        const rows = await EpochNftTransfer.destroy({where:{epoch:{[Op.lt]: finalizedEpoch}}, limit: 10000})
        console.log(`rows ${rows}`)
        if(!rows) {
            console.log(`done!`)
            return
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
if((type === 6 || type === 15)&& args[2]){
    epochNumber = Number(args[2]);
}
if(type === 8 && args[2] && args[3]){
    minEpoch = Number(args[2]);
    maxEpoch = Number(args[3]);
}
// node script 1029 10 minEpoch maxEpoch
if((type === 9 || type === 10 || type === 12) && args[2] && args[3]){
    minEpoch = Number(args[2]);
    maxEpoch = Number(args[3]);
}
if(type === 10 && args[2] && args[3] && args[4]){
    minEpoch = Number(args[2]);
    maxEpoch = Number(args[3]);
    store = Number(args[4]);
}
if(type === 13 && args[2]){
    contractId = Number(args[2]);
}
if((type === 14 || type === 18 || type === 19) && args[2]) {
    loop = Number(args[2]);
}

console.log(`params======networkId:${StatApp.networkId}======type:${type}======minEpoch:${minEpoch}======maxEpoch:${maxEpoch}======toFindHexAddress:${toFindHexAddress}`);
run().then();
