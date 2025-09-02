import {format} from "js-conflux-sdk";
import {Hex40Map} from "../../stat/model/HexMap";
import {AddressTransactionIndex} from "../../stat/model/FullBlock";
import {
    checkPresent,
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent
} from "../../stat/service/common/utils";
import {StatApp} from "../../stat/StatApp";
import {setBody} from "../router/middleware";
import {CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG} from "../common/Def";
import {getApiService} from "../ApiServer";
import {polishContract} from "./OpenContractService";
import {toBase32} from "../../stat/service/tool/AddressTool";
import {TraceCreateContract} from "../../stat/model/TraceCreateContract";
import {QueryTypes} from "sequelize";
import {paginateCore} from "../../stat/router/ParamChecker";
import {formatAddr} from "../common/RestTool";
import {decodeTxData} from "../../stat/service/tool/TxTool";

const lodash = require('lodash');
const LRU = require('lru-cache');
const CONTRACT_CACHE = new LRU({max: 500});

/**
 * query transactions of one account(address)
 * @param ctx
 */
export async function listAccountTransaction(ctx) {
    mustBeIntParamIfPresent(ctx.request.query, 'minEpochNumber','maxEpochNumber', 'startBlock', 'endBlock', 'minTimestamp','maxTimestamp')
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'from','to','account')
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

async function getVerifiedContract(base32){
    const cache = CONTRACT_CACHE.get(base32);
    if(cache) {
        return JSON.parse(cache);
    }

    const verify: any = await getApiService().contractQuery.queryVerify(base32, true)
    if(!verify){
        return null;
    }

    verify.proxy = verify.proxy === true
    CONTRACT_CACHE.set(base32, JSON.stringify(verify));
    return verify;
}

export async function abiDecode(ctx){
    const {hashes} = ctx.request.query;
    checkPresent({hashes}, ['hashes']);

    const hashArray = hashes.split(',');
    const decodeMap = {};
    lodash.map(hashArray, (hash) => decodeMap[hash] = {hash});
    if(hashArray.length > 10){
        setBody(ctx, null, 1, `The max size of hashArray is 10`);
        return
    }

    const {txMap} = await getApiService().fullBlockQuery.batchGetTransactionList({hashArray});
    for(const hash of hashArray) {
        const tx = txMap[hash];
        if(!tx){
            lodash.assign(decodeMap[hash], { error: `Tx (${hash}) not found` });
            continue;
        }

        const data = tx.data;
        if(data === '0x'){
            lodash.assign(decodeMap[hash], { error: `Tx's data (${data}) not found` });
            continue;
        }

        const result = await decodeMethod(tx.to, data);
        lodash.assign(decodeMap[hash], result);
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
        setBody(ctx, null, 1, `The length of contractArray and inputArray not match`);
        return
    }
    if(contractArray.length > 10){
        setBody(ctx, null, 1, `The max size of inputArray is 10`);
        return
    }

    const response = lodash.zip(contractArray, inputArray).map(item => ({contract: item[0], input: item[1]}));
    for(const tx of response) {
        const data = tx.input;
        if(!data){
            lodash.assign(tx, { error: `Tx's input (${data}) not found` });
            continue;
        }
        if(!data.startsWith('0x')){
            lodash.assign(tx, { error: `Tx's input (${data}) not starts with 0x` });
            continue;
        }

        const toAddr = tx.contract;
        let hexAddr;
        try{
            hexAddr = format.hexAddress(toAddr).substr(2);
        } catch (e){
            lodash.assign(tx, { error: `Address (${formatAddr(toAddr)}) invalid` });
            continue;
        }
        const sql = `select * from trace_create_contract trace where trace.to = (select id from hex40 where hex = ?)`;
        const trace = await TraceCreateContract.sequelize.query(sql, {type: QueryTypes.SELECT, replacements: [hexAddr]})
            .then(arr=>{ return arr[0]; });
        if(!trace){
            lodash.assign(tx, { error: `Address (${formatAddr(toAddr)}) not a contract` });
            continue;
        }

        const result = await decodeMethod(toAddr, data);
        lodash.assign(tx, result);
    }

    setBody(ctx, response);
}

async function decodeMethod(toAddr, data) {
    const base32 = toBase32(toAddr);
    let contract = await getVerifiedContract(base32);
    if(!contract){
        return  { error: `Contract (${formatAddr(toAddr)}) not verified` };
    }

    let result = decodeTxData(contract['abi'], data);
    if(!(!result['error'] && !result['decodedData'] && contract.proxy)) {
        return result;
    }

    const impl = await getApiService().contractQuery.queryImplementation(base32)
    contract = await getVerifiedContract(impl.implementation);
    if(!contract){
        return  { error: `The proxy's (${formatAddr(toAddr)}) implementation contract (${formatAddr(impl.implementation)}) not verified` };
    }

    return decodeTxData(contract['abi'], data);
}

