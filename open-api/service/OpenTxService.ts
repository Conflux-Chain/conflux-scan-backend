import {format} from "js-conflux-sdk";
import {Hex40Map} from "../../stat/model/HexMap";
import {AddressTransactionIndex} from "../../stat/model/FullBlock";
import {
    checkPresent,
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent, skipLimit
} from "../../stat/service/common/utils";
import {StatApp} from "../../stat/StatApp";
import {setBody} from "../router/middleware";
import {CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG} from "../common/Def";
import {getApiService} from "../ApiServer";
import {polishContract} from "./OpenContractService";
import {ContractVerify} from "../../stat/model/ContractVerify";
import {toBase32} from "../../stat/service/tool/AddressTool";
import {TraceCreateContract} from "../../stat/model/TraceCreateContract";
import {QueryTypes} from "sequelize";
import {paginateCore} from "../../stat/router/ParamChecker";

const lodash = require('lodash');
const abiDecoder = require('abi-decoder');
const LRU = require('lru-cache');
const CONTRACT_CACHE = new LRU({max: 500});

/**
 * query transactions of one account(address)
 * @param ctx
 */
export async function listAccountTransaction(ctx) {
    mustBeIntParamIfPresent(ctx.request.query, 'minEpochNumber','maxEpochNumber', 'startBlock', 'endBlock', 'minTimestamp','maxTimestamp')
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'from','to','account')
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])
    mustBeEnumParamIfPresent(ctx.request.query, 'withInput', ['false', 'true']);
    const {skip, limit} = paginateCore(ctx.request.query)
    const {account: base32,minEpochNumber,maxEpochNumber,startBlock, endBlock, minTimestamp,maxTimestamp,from, to, sort, nonce, txType, withInput} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
        return
    }

    const startEpoch = StatApp.isEVM ? startBlock : minEpochNumber;
    const endEpoch = StatApp.isEVM ? endBlock : maxEpochNumber;
    const page = await getApiService().fullBlockQuery.listTransaction({accountAddress: base32, skip, limit,
        verboseAddress: false, minEpochNumber: startEpoch, maxEpochNumber: endEpoch, minTimestamp, maxTimestamp, from, to, sort, nonce, txType
    });

    const hashArray = [];
    page?.list?.forEach(tx=>{
        delete tx.syncTimestamp
        delete tx.blockHash
        if (StatApp.isEVM) {
            tx['blockNumber'] = tx.epochNumber;
            delete tx.epochNumber;
            delete tx.blockPosition;
            tx['contractAddress'] = tx.contractCreated;
            delete tx.contractCreated;
            tx['isError'] = tx.txExecErrorMsg ? '1' : '0';
        }
        hashArray.push(tx.hash);
    })

    if (StatApp.isEVM || (!StatApp.isEVM && withInput === 'true')) {
        const resp = await getApiService().fullBlockQuery.batchGetTransactionList({hashArray});
        const {txMap} = resp;
        page?.list?.forEach(tx=>{
            tx['input'] = txMap[tx.hash]?.data;
            if(StatApp.isEVM){
                tx['blockHash'] = txMap[tx.hash]?.blockHash;
            }
        })
    }

    delete page.extraInfo
    await polishContract(page)
    setBody(ctx, page)
}

export async function base32id(base32: string) {
    const hex = format.hexAddress(base32)
    return Hex40Map.findOne({where: {hex: hex.substr(2)} });
}

export async function queryAccountTx({base32,startEpoch,endEpoch,startTimestamp,endTimestamp,sort
                                     }) {
    const ownerId = await base32id(base32);
    const page = await AddressTransactionIndex.findAndCountAll({
        where: {addressId: ownerId}
    })
}

async function getVerifiedContract(address){
    const base32 = toBase32(address);
    let cache = CONTRACT_CACHE.get(base32);
    if(cache) {
        return JSON.parse(cache);
    }

    const verify = await ContractVerify.findOne({ attributes: ['abi'], where: { base32, verifyResult: true}});
    if(!verify){
        return null;
    }

    CONTRACT_CACHE.set(base32, JSON.stringify(verify));
    return verify;
}

export async function abiDecode(ctx){
    const {hashes} = ctx.request.query;
    checkPresent({hashes}, ['hashes']);

    const hashArray = hashes.split(',');
    const decodeMap = {};
    lodash.map(hashArray, (hash) => decodeMap[hash] = {hash});

    const {txMap} = await getApiService().fullBlockQuery.batchGetTransactionList({hashArray});
    for(const hash of hashArray) {
        const tx = txMap[hash];
        if(!tx){
            lodash.assign(decodeMap[hash], { error: `tx:${hash} not found` });
            continue;
        }

        const data = tx.data;
        if(data === '0x'){
            lodash.assign(decodeMap[hash], { error: `tx.data:${data} not found` });
            continue;
        }

        const toAddress =  tx.to;
        const verify = await getVerifiedContract(toAddress);
        if(!verify){
            lodash.assign(decodeMap[hash], { error: `contract:${toAddress} not verified` });
            continue;
        }

        const abiString = verify['abi'];
        let abiArray;
        let decodedData;
        try{
            abiArray = JSON.parse(abiString);
            abiDecoder.addABI(abiArray);
            decodedData = abiDecoder.decodeMethod(data);
        } catch (e){
            lodash.assign(decodeMap[hash], { error: `abi decode:${e.message}` });
            continue;
        } finally {
            abiDecoder.removeABI(abiArray);
        }
        lodash.assign(decodeMap[hash], { decodedData });
    }

    const response = lodash.map(hashArray, hash => decodeMap[hash]);
    setBody(ctx, response);
}

export async function abiDecodeRaw(ctx){
    const {contracts, inputs} = ctx.request.query;
    checkPresent({contracts, inputs}, ['contracts', 'inputs']);

    const contractArray = contracts.split(',');
    const inputArray = inputs.split(',');
    if(contractArray.length !== inputArray.length){
        setBody(ctx, null, 1, `the length of contractArray and inputArray not match`);
        return
    }

    const response = lodash.zip(contractArray, inputArray).map(item => ({contract: item[0], input: item[1]}));
    for(const tx of response) {
        const data = tx.input;
        if(!data){
            lodash.assign(tx, { error: `tx.input:${data} not found` });
            continue;
        }
        if(!data.startsWith('0x')){
            lodash.assign(tx, { error: `tx.input:${data} not starts with 0x` });
            continue;
        }

        const toAddr =  tx.contract;
        let hexAddr;
        try{
            hexAddr = format.hexAddress(toAddr).substr(2);
        } catch (e){
            lodash.assign(tx, { error: `address:${toAddr} invalid` });
            continue;
        }
        const sql = `select * from trace_create_contract trace where trace.to = (select id from hex40 where hex = ?)`;
        const trace = await TraceCreateContract.sequelize.query(sql, {type: QueryTypes.SELECT, replacements: [hexAddr]})
            .then(arr=>{ return arr[0]; });
        if(!trace){
            lodash.assign(tx, { error: `address:${toAddr} not a contract` });
            continue;
        }
        const verify = await getVerifiedContract(toAddr);
        if(!verify){
            lodash.assign(tx, { error: `contract:${toAddr} not verified` });
            continue;
        }

        const abiString = verify['abi'];
        let abiArray;
        let decodedData;
        try{
            abiArray = JSON.parse(abiString);
            abiDecoder.addABI(abiArray);
            decodedData = abiDecoder.decodeMethod(data);
        } catch (e){
            lodash.assign(tx, { error: `abi decode:${e.message}` });
            continue;
        } finally {
            abiDecoder.removeABI(abiArray);
        }
        lodash.assign(tx, { decodedData });
    }

    setBody(ctx, response);
}
