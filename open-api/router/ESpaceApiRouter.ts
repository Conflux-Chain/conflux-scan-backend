import * as Router from "koa-router";
import {Op} from "sequelize";
import {format} from "js-conflux-sdk";
import {getApiService} from "../ApiServer";
import {StatApp} from "../../stat/StatApp";
import {FailedTx, FullTransaction} from "../../stat/model/FullBlock";
import {Epoch} from "../../stat/model/Epoch";
import {setBody} from "./middleware";
import {
    listAccountAssets,
} from "../service/OpenAccountService";
import {
    abiDecode, abiDecodeRaw,
    listAccountTransaction,
} from "../service/OpenTxService";
import {
    listAccountCfxTransfer,
    listAccountTransfer20,
    listAccountTransfer721,
    listAccountTransfer1155,
    listAccountTransfer3525,
} from "../service/OpenTransferService";
import {
    getABI,
    getSourceCode,
    verifySourcecode,
    checkVerifyStatus,
    verifyProxyContract,
    checkProxyVerification,
} from "../service/OpenContractService";
import {
    queryTokenInfo
} from "../service/OpenTokenService";
import {
    listNFTBalances,
    listNFTTokens,
    getNFTPreview,
    listNFTTokensByFts,
} from "../service/OpenNFTService";
import {
    getSupplyStat,
    listAccountActiveStat,
    listAccountGrowthStat,
    listCfxHolderStat,
    listCfxReceiverTopStat,
    listCfxSenderTopStat,
    listCfxTransferStat,
    listContractStat,
    listGasUsedTopStat,
    listMinerTopStat,
    listMiningStat, listTokenHolderStat,
    listTokenParticipantTopStat,
    listTokenReceiverTopStat,
    listTokenSenderTopStat,
    listTokenTransferStat,
    listTokenTransferTopStat, listTokenUniqueParticipantStat, listTokenUniqueReceiverStat, listTokenUniqueSenderStat,
    listTpsStat,
    listTransactionReceiverTopStat,
    listTransactionSenderTopStat,
    listTransactionStat,
} from "../service/OpenStatService";
import {
    checkPresent,
    getPaginationESpace,
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeHex64ParamIfPresent,
    mustBeIntParamIfPresent,
} from "../../stat/service/common/utils";
import { CONST } from '../../stat/service/common/constant';

const lodash = require('lodash');

const EPOCH_NUMBER_LABEL_ARRAY = ['latest_mined', 'latest_state', 'latest_finalized', 'latest_confirmed',
    'latest_checkpoint', 'earliest'];
// -----------------------------------biz---------------------------------------
async function gateway(ctx) {
    const {E_SPACE_OPENAPI: {ACCOUNT, CONTRACT, TRANSACTION, BLOCK, TOKEN, STATS}} = CONST;
    const {module, action} = parseGatewayParam(ctx);

    let handler;
    switch (module) {
        case ACCOUNT.module:
            switch (action) {
                case ACCOUNT.action.BALANCE:
                    handler = getBalance;
                    break;
                case ACCOUNT.action.BALANCE_MULTI:
                    handler = listBalance;
                    break;
                case ACCOUNT.action.TX_LIST:
                    handler = listTx;
                    break;
                case ACCOUNT.action.TX_LIST_INTERNAL:
                    handler = listTransferCfx;
                    break;
                case ACCOUNT.action.TOKEN_TX:
                    handler = listTransfer20;
                    break;
                case ACCOUNT.action.TOKEN_NFT_TX:
                    handler = listTransfer721;
                    break;
                case ACCOUNT.action.GET_MINED_BLOCKS:
                    handler = listBlock;
                    break;
                case ACCOUNT.action.BALANCE_HISTORY:
                    handler = getBalanceHistory;
                    break;
                case ACCOUNT.action.TOKEN_BALANCE:
                    handler = getTokenBalance;
                    break;
                case ACCOUNT.action.TOKEN_BALANCE_HISTORY:
                    handler = getTokenBalanceHistory;
                    break;
                default:
                    return Promise.reject(`unknown action:${action} of module:${module}`);
            }
            break;
        case CONTRACT.module:
            switch (action) {
                case CONTRACT.action.GET_ABI:
                    handler = getABI;
                    break;
                case CONTRACT.action.GET_SOURCECODE:
                    handler = getSourceCode;
                    break;
                case CONTRACT.action.VERIFY_SOURCECODE:
                    handler = verifySourcecode;
                    break;
                case CONTRACT.action.CHECK_VERIFY_STATUS:
                    handler = checkVerifyStatus;
                    break;
                case CONTRACT.action.VERIFY_PROXY_CONTRACT:
                    handler = verifyProxyContract;
                    break;
                case CONTRACT.action.CHECK_PROXY_VERIFICATION:
                    handler = checkProxyVerification;
                    break;
                default:
                    return Promise.reject(`unknown action:${action} of module:${module}`);
            }
            break;
        case TRANSACTION.module:
            switch (action) {
                case TRANSACTION.action.GET_STATUS:
                    handler = getStatus;
                    break;
                case TRANSACTION.action.GET_TX_RECEIPT_STATUS:
                    handler = getTxReceiptStatus;
                    break;
                default:
                    return Promise.reject(`unknown action:${action} of module:${module}`);
            }
            break;
        case BLOCK.module:
            switch (action) {
                case BLOCK.action.GET_BLOCK_NO_BY_TIME:
                    handler = getBlockNoByTime;
                    break;
                default:
                    return Promise.reject(`unknown action:${action} of module:${module}`);
            }
            break;
        case TOKEN.module:
            switch (action) {
                case TOKEN.action.TOKEN_INFO:
                    handler = getTokenInfo;
                    break;
                default:
                    return Promise.reject(`unknown action:${action} of module:${module}`);
            }
            break;
        case STATS.module:
            switch (action) {
                case STATS.action.TOKEN_SUPPLY:
                    handler = getTokenSupply;
                    break;
                case STATS.action.TOKEN_SUPPLY_HISTORY:
                    handler = getTokenSupplyHistory;
                    break;
                default:
                    return Promise.reject(`unknown action:${action} of module:${module}`);
            }
            break;
        default:
            return Promise.reject(`unknown module:${module}`);
    }

    await handler(ctx);
}

async function getBalance(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'address');
    mustBeEnumParamIfPresent(ctx.request.query, 'tag', EPOCH_NUMBER_LABEL_ARRAY);
    const {address, tag} = ctx.request.query;
    checkPresent({address}, ['address']);

    const result = await getApiService().cfx.getBalance(address, tag);
    setBody(ctx, result)
}

async function listBalance(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'tag', EPOCH_NUMBER_LABEL_ARRAY);
    const {address, tag} = ctx.request.query;
    checkPresent({address}, ['address']);

    const addressArray = address?.split(',') || [];
    addressArray.forEach(item => {
        if (!/0x[0-9a-fA-F]{40}/.test(item)) {
            throw new Error(`Invalid address parameter [${item}] with value [${item}].`);
        }
    });

    const promiseArray = addressArray.map(address => getApiService().cfx.getBalance(address, tag));
    const balanceArray = await Promise.all(promiseArray);
    const result = lodash.zip(addressArray, balanceArray);
    setBody(ctx, result)
}

async function listTx(ctx) {
    const {address, startblock, endblock, sort, page, offset} = parseListTransferParam(ctx);
    checkPresent({address}, ['address']);

    const skip = (page - 1) * offset;
    const pagedTxs = await getApiService().fullBlockQuery.listTransaction({accountAddress: address,
        minEpochNumber: startblock, maxEpochNumber: endblock, sort, skip, limit: offset
    });

    const hashArray = [];
    const result = pagedTxs?.list?.map(item => {
        hashArray.push(item.hash);
        return {
            blockNumber: `${item.epochNumber}`,
            timestamp: `${item.timestamp}`,
            hash: item.hash,
            nonce: item.nonce,
            blockHash: '',
            transactionIndex: `${item.transactionIndex}`,
            from: format.hexAddress(item.from),
            to: item.to ? format.hexAddress(item.to) : '',
            value: item.value,
            gas: '',
            gasPrice: item.gasPrice,
            isError: item.status === 0 ? '0' : '1',
            txreceipt_status: item.status === 0 ? '1' : '0',
            input: '',
            contractAddress: item.contractCreated? format.hexAddress(item.contractCreated) : '',
            cumulativeGasUsed: '',
            gasUsed: '',
            confirmations: '',
        }
    }) || [];

    const confirmedEpochNumber = await getApiService().cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_CONFIRMED);
    const resp = await getApiService().fullBlockQuery.batchGetTransactionList({hashArray});
    const {txMap, receiptMap} = resp;
    result.forEach(item=>{
        item['input'] = txMap[item.hash]?.data;
        item['blockHash'] = txMap[item.hash]?.blockHash;
        item['gas'] = txMap[item.hash]?.gas;
        item['cumulativeGasUsed'] = receiptMap[item.hash]?.gasUsed;
        item['gasUsed'] = receiptMap[item.hash]?.gasUsed;
        item['confirmations'] = `${Math.max(confirmedEpochNumber - Number(item.blockNumber), 0)}`;
    })
    setBody(ctx, result)
}

async function listTransferCfx(ctx) {
    const {txhash, address, startblock, endblock, sort, page, offset} = parseListTransferParam(ctx);
    if(!(txhash !== undefined ||  address !== undefined || (startblock !== undefined && endblock !== undefined))){
        throw new Error(`The txhash or address and/or block range parameters are required.`);
    }

    let options;
    const skip = (page - 1) * offset;
    if (txhash) {
        options = {transactionHash: txhash};
    } else if (address) {
        options = {accountAddress: address, minEpochNumber: startblock, maxEpochNumber: endblock, sort,
            skip, limit: offset};
    } else {
        options = {minEpochNumber: startblock, maxEpochNumber: endblock, sort, skip, limit: offset};
    }
    const pagedTransfers = await getApiService().cfxTransferQuery.listTransfer(options);

    const result = pagedTransfers?.list?.map(item => ({
        blockNumber: `${item.epochNumber}`,
        timestamp: `${item.timestamp}`,
        hash: item.transactionHash,
        from: format.hexAddress(item.from),
        to: format.hexAddress(item.to),
        value: item.value,
        contractAddress: "",
        input:"",
        type: item.type,
        traceId: `${item.transactionLogIndex}`,
        isError:"0",
        errCode:""
    })) || [];
    setBody(ctx, result)
}

async function listTransfer20(ctx) {
    const {contractaddress, address, startblock, endblock, sort, page, offset} = parseListTransferParam(ctx);
    if(contractaddress === undefined && address === undefined){
        throw new Error(`The contractaddress and/or address parameters are required.`);
    }

    const skip = (page - 1) * offset;
    const pagedTransfers = await getApiService().crc20transferQuery.listTransfer({ accountAddress: address,
        address: contractaddress, minEpochNumber: startblock, maxEpochNumber: endblock, sort, skip, limit: offset});

    const result = pagedTransfers?.list?.map(item => ({
        blockNumber: `${item.epochNumber}`,
        hash: item.transactionHash,
        timestamp: `${item.timestamp}`,
        from: format.hexAddress(item.from),
        to: format.hexAddress(item.to),
        value: item.value,
        contractAddress: format.hexAddress(item.address),
    })) || [];
    await addTokenBasicInfo(result);
    setBody(ctx, result)
}

async function listTransfer721(ctx) {
    const {contractaddress, address, startblock, endblock, sort, page, offset} = parseListTransferParam(ctx);
    if(contractaddress === undefined && address === undefined){
        throw new Error(`The contractaddress and/or address parameters are required.`);
    }

    const skip = (page - 1) * offset;
    const pagedTransfers = await getApiService().crc721transferQuery.listTransfer({ accountAddress: address,
        address: contractaddress, minEpochNumber: startblock, maxEpochNumber: endblock, sort, skip, limit: offset});

    const result = pagedTransfers?.list?.map(item => ({
        blockNumber: `${item.epochNumber}`,
        hash: item.transactionHash,
        timestamp: `${item.timestamp}`,
        from: format.hexAddress(item.from),
        to: format.hexAddress(item.to),
        tokenID: `${item.tokenId}`,
        contractAddress: format.hexAddress(item.address),
    })) || [];
    await addTokenBasicInfo(result);
    setBody(ctx, result)
}

async function listBlock(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'address');
    mustBeEnumParamIfPresent(ctx.request.query, 'blocktype', ['blocks']);
    mustBeIntParamIfPresent(ctx.request.query, 'page', 'offset');
    const {address} = ctx.request.query;
    checkPresent({address}, ['address']);

    const {page, offset} = getPaginationESpace(ctx.request.query);

    const skip = (page - 1) * offset;
    const pagedBlocks = await getApiService().fullBlockQuery.listBlock({ miner: address, skip, limit: offset});

    const result = pagedBlocks?.list?.map(item => ({
        blockNumber: `${item.epochNumber}`,
        timestamp: `${item.timestamp}`,
        blockReward: item.totalReward,
    })) || [];
    setBody(ctx, result)
}

async function getBalanceHistory(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'address');
    mustBeIntParamIfPresent(ctx.request.query, 'blockno');
    const {address, blockno: epochNumber} = ctx.request.query;
    checkPresent({address, blockno: epochNumber}, ['address', 'blockno']);

    const result = await getApiService().cfx.getBalance(address, epochNumber);
    setBody(ctx, result)
}

async function getTokenBalance(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contractaddress', 'address');
    const {contractaddress, address} = ctx.request.query;
    checkPresent({contractaddress, address}, ['contractaddress', 'address']);

    const result = await getApiService().tokenTool.getTokenBalance(contractaddress, address, undefined);
    setBody(ctx, result)
}

async function getTokenBalanceHistory(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contractaddress', 'address');
    mustBeIntParamIfPresent(ctx.request.query, 'blockno');
    const {contractaddress, address, blockno: epochNumber} = ctx.request.query;
    checkPresent({contractaddress, address, blockno: epochNumber}, ['contractaddress', 'address', 'blockno']);

    let result = await getApiService().tokenTool.getTokenBalance(contractaddress, address, epochNumber);
    result = result === undefined ? '0' : result;
    setBody(ctx, result)
}

async function getStatus(ctx) {
    mustBeHex64ParamIfPresent(ctx.request.query, 'txhash')
    const {txhash} = ctx.request.query;
    checkPresent({txhash}, ['txhash']);

    const tx = await FullTransaction.findOne({where: {hash: txhash}});
    if(!tx){
        setBody(ctx, undefined, 1, `tx ${txhash} not found` );
        return;
    }

    let result;
    if(tx.status === 0){
        result = {isError: '0'};
    } else{
        const failedTx = await FailedTx.findOne({where: lodash.pick(tx, ['epoch', 'blockPosition', 'txPosition'])});
        result = {isError: '1', errDescription: failedTx.txExecErrorMsg};
    }
    setBody(ctx, result)
}

async function getTxReceiptStatus(ctx) {
    mustBeHex64ParamIfPresent(ctx.request.query, 'txhash')
    const {txhash} = ctx.request.query;
    checkPresent({txhash}, ['txhash']);

    const tx = await FullTransaction.findOne({where: {hash: txhash}});
    if(!tx){
        setBody(ctx, undefined, 1, `tx ${txhash} not found` );
        return;
    }

    const result = { status: tx.status === 0 ? '1' : '0'};
    setBody(ctx, result)
}

async function getBlockNoByTime(ctx) {
    mustBeIntParamIfPresent(ctx.request.query, 'timestamp');
    mustBeEnumParamIfPresent(ctx.request.query, 'closest', ['before', 'after']);
    let {timestamp, closest} = ctx.request.query;
    checkPresent({timestamp}, ['timestamp']);

    closest = closest === undefined ? 'before' : closest;

    const comparator = closest === 'before' ? Op.lte : Op.gte;
    const datetime =  new Date(timestamp * 1000);
    console.log(`timestamp:${timestamp},UTC:${datetime.toUTCString()},TimezoneOffset:${datetime.getTimezoneOffset()}`);
    const epoch = await Epoch.findOne({
        where: {timestamp: {[comparator]: datetime}},
        order: [['epoch', 'DESC']],
    });
    if(!epoch){
        setBody(ctx, undefined, 1, `blockno ${closest} timestamp ${timestamp} not found` );
        return;
    }

    const result = epoch.epoch;
    setBody(ctx, result)
}

async function getLogs(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'address');
    mustBeHex64ParamIfPresent(ctx.request.query, 'topic0', 'topic1', 'topic2', 'topic3');
    let {
        fromBlock, toBlock, address,
        topic0, topic1, topic2, topic3,
    } = ctx.request.query;

    // check block range param
    if(fromBlock === undefined || (!/^[0-9]+$/.test(fromBlock) && fromBlock !== 'latest')) {
        throw new Error(`Invalid fromBlock parameter with value [${fromBlock}].`);
    }
    if(toBlock === undefined || (!/^[0-9]+$/.test(toBlock) && toBlock !== 'latest')) {
        throw new Error(`Invalid toBlock parameter with value [${toBlock}].`);
    }
    fromBlock = fromBlock === 'latest' ? fromBlock : parseInt(fromBlock);
    toBlock = toBlock === 'latest' ? toBlock : parseInt(toBlock);

    // check address param and topic param
    if(address === undefined && topic0 === undefined && topic1 === undefined && topic2 === undefined
        && topic3 === undefined){
        throw new Error(`An address and/or topic(X) parameters are required.`);
    }

    const topics = [null, null, null, null];
    topic0 && (topics[0] = topic0);
    topic1 && (topics[1] = topic1);
    topic2 && (topics[2] = topic2);
    topic3 && (topics[3] = topic3);
    const limit = 1000;
    const options = {fromBlock, toBlock, address, topics, limit};
    const logArray = (await getApiService().eth.getLogs(options)) || [];
    console.log(`[getLogs]options:${JSON.stringify(options)},logs:${JSON.stringify(logArray)}`);
    const result = logArray.slice(0, limit);
    setBody(ctx, result)
}

async function getTokenInfo(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contractaddress');
    const {contractaddress} = ctx.request.query;
    checkPresent({contractaddress}, ['contractaddress']);

    const tokenInfo = await queryTokenInfo(contractaddress);
    if(!tokenInfo){
        setBody(ctx, undefined, 1, `token ${contractaddress} not found` );
        return;
    }

    const result = [tokenInfo];
    setBody(ctx, result)
}

async function getTokenSupply(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contractaddress');
    const {contractaddress} = ctx.request.query;
    checkPresent({contractaddress}, ['contractaddress']);

    const result = await getApiService().tokenTool.getTokenTotalSupply(contractaddress, undefined);
    setBody(ctx, result)
}

async function getTokenSupplyHistory(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contractaddress');
    mustBeIntParamIfPresent(ctx.request.query, 'blockno');
    const {contractaddress, blockno: epochNumber} = ctx.request.query;
    checkPresent({contractaddress, blockno: epochNumber}, ['contractaddress', 'blockno']);

    let result = await getApiService().tokenTool.getTokenTotalSupply(contractaddress, epochNumber);
    result = result === undefined ? '0' : result;
    setBody(ctx, result)
}

// -----------------------------------tool---------------------------------------
function parseGatewayParam(ctx) {
    const requestData = Object.keys(ctx.request.query).length ? ctx.request.query : ctx.request.body;
    mustBeEnumParamIfPresent(requestData, 'module', [... getApiService().moduleSet]);
    mustBeEnumParamIfPresent(requestData, 'action', [... getApiService().actionSet]);

    const {module, action} = requestData
    return {module, action};
}

function parseListTransferParam(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contractaddress', 'address');
    mustBeIntParamIfPresent(ctx.request.query, 'page', 'offset', 'startblock', 'endblock');
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['asc', 'desc']);
    const {page, offset} = getPaginationESpace(ctx.request.query);
    const {txhash, contractaddress, address, startblock, endblock, sort} = ctx.request.query;
    return {txhash, contractaddress, address, startblock, endblock, sort, page, offset};
}

async function addTokenBasicInfo(result) {
    const addressArray = result.map(item => item.contractAddress);
    const tokenArray = await getApiService().tokenQuery.list({addressArray}).then(response => response.list);
    const tokenMap = lodash.keyBy(tokenArray, item => format.hexAddress(item.address));
    result.forEach(item => {
        item['tokenName'] = tokenMap[item.contractAddress]?.name;
        item['tokenSymbol'] = tokenMap[item.contractAddress]?.symbol;
        item['tokenDecimal'] = `${tokenMap[item.contractAddress]?.decimals || 0}`;
    });
}

// -----------------------------------router---------------------------------------
export function registerRouter(router: Router) {
    router.get('/api', gateway)
    router.post('/api', gateway)

    // nft assets
    router.get('/nft/balances', listNFTBalances);
    router.get('/nft/tokens', listNFTTokens);
    router.get('/nft/preview', getNFTPreview);
    router.get('/nft/fts', listNFTTokensByFts);

    // utils
    router.get('/util/decode/method', abiDecode);
    router.get('/util/decode/method/raw', abiDecodeRaw);

    // statistics
    router.get('/statistics/mining', listMiningStat)
    router.get('/statistics/supply', getSupplyStat);
    router.get('/statistics/tps', listTpsStat);
    router.get('/statistics/contract', listContractStat);
    router.get('/statistics/account/cfx/holder', listCfxHolderStat);
    router.get('/statistics/account/growth', listAccountGrowthStat);
    router.get('/statistics/account/active', listAccountActiveStat);
    router.get('/statistics/transaction', listTransactionStat);
    router.get('/statistics/cfx/transfer', listCfxTransferStat);
    router.get('/statistics/token/transfer', listTokenTransferStat);
    router.get('/statistics/top/gas/used', listGasUsedTopStat);
    router.get('/statistics/top/miner', listMinerTopStat);
    router.get('/statistics/top/transaction/sender', listTransactionSenderTopStat);
    router.get('/statistics/top/transaction/receiver', listTransactionReceiverTopStat);
    router.get('/statistics/top/cfx/sender', listCfxSenderTopStat);
    router.get('/statistics/top/cfx/receiver', listCfxReceiverTopStat);
    router.get('/statistics/top/token/transfer', listTokenTransferTopStat);
    router.get('/statistics/top/token/sender', listTokenSenderTopStat);
    router.get('/statistics/top/token/receiver', listTokenReceiverTopStat);
    router.get('/statistics/top/token/participant', listTokenParticipantTopStat);
    router.get('/statistics/token/holder', listTokenHolderStat);
    router.get('/statistics/token/unique/sender', listTokenUniqueSenderStat);
    router.get('/statistics/token/unique/receiver', listTokenUniqueReceiverStat);
    router.get('/statistics/token/unique/participant', listTokenUniqueParticipantStat);

    // account(deprecated)
    router.get('/account/transactions', listAccountTransaction)
    router.get('/account/cfx/transfers', listAccountCfxTransfer)
    router.get('/account/crc20/transfers', listAccountTransfer20)
    router.get('/account/crc721/transfers', listAccountTransfer721)
    router.get('/account/crc1155/transfers', listAccountTransfer1155)
    router.get('/account/crc3525/transfers', listAccountTransfer3525)
    router.get('/account/tokens', listAccountAssets)
}
