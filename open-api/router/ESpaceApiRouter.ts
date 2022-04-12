import * as Router from "koa-router";
import {format} from "js-conflux-sdk";
import {getApiService} from "../ApiServer";
import {StatApp} from "../../stat/StatApp";
import {InvalidParamError} from "../../stat/router/ParamChecker";
import {listAccountAssets} from "../service/OpenAccountService";
import {listAccountTransaction} from "../service/OpenTxService";
import {listNFTBalances, listNFTTokens, getNFTPreview} from "../service/OpenNFTService";
import {
    listAccountCfxTransfer,
    listAccountTransfer20,
    listAccountTransfer721,
    listAccountTransfer1155
} from "../service/OpenTransferService";
import {
    getPaginationESpace,
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent, mustBeIntParamIfPresent,
} from "../../stat/service/common/utils";

const lodash = require('lodash');
const CONST = require('../../stat/service/common/constant');

const EPOCH_NUMBER_LABEL_ARRAY = ['latest_mined', 'latest_state', 'latest_finalized', 'latest_confirmed',
    'latest_checkpoint', 'earliest'];
// -----------------------------------biz---------------------------------------
async function gateway(ctx) {
    const {E_SPACE_OPENAPI: {MODULE, ACTION}} = CONST;
    const {module, action} = parseGatewayParam(ctx);

    let handler;
    switch (module) {
        case MODULE.ACCOUNT:
            switch (action) {
                case ACTION.BALANCE:
                    handler = getBalance;
                    break;
                case ACTION.BALANCE_MULTI:
                    handler = listBalance;
                    break;
                case ACTION.TX_LIST:
                    handler = listTx;
                    break;
                case ACTION.TX_LIST_INTERNAL:
                    handler = listTransferCfx;
                    break;
                case ACTION.TOKEN_TX:
                    handler = listTransfer20;
                    break;
                case ACTION.TOKEN_NFT_TX:
                    handler = listTransfer721;
                    break;
                case ACTION.GET_MINED_BLOCKS:
                    handler = listBlock;
                    break;
                case ACTION.BALANCE_HISTORY:
                    handler = getBalanceHistory;
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

    const result = await getApiService().cfx.getBalance(address, tag);
    setBody(ctx, result)
}

async function listBalance(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'tag', EPOCH_NUMBER_LABEL_ARRAY);
    const {address, tag} = ctx.request.query;
    const addressArray = address?.split(',') || [];
    if(!addressArray.length){
        throw new InvalidParamError(`Invalid address parameter [${address}] with value [${address}].`);
    }
    addressArray.forEach(item => {
        if (!/0x[0-9a-fA-F]{40}/.test(item)) {
            throw new InvalidParamError(`Invalid address parameter [${item}] with value [${item}].`);
        }
    });

    const promiseArray = addressArray.map(address => getApiService().cfx.getBalance(address, tag));
    const balanceArray = await Promise.all(promiseArray);
    const result = lodash.zip(addressArray, balanceArray);
    setBody(ctx, result)
}

async function listTx(ctx) {
    const {address, startblock, endblock, sort, page, offset} = parseListTransferParam(ctx);
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
            to: format.hexAddress(item.to),
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
    const skip = (page - 1) * offset;

    let options;
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
    mustBeEnumParamIfPresent(ctx.request.query, 'blocktype', ['blocks', 'uncles']);
    mustBeIntParamIfPresent(ctx.request.query, 'page', 'offset');
    const {address} = ctx.request.query;
    if (address === undefined) {
        throw new Error(`Invalid parameter <address> with value [${address}], address is required.`)
    }
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

    const result = await getApiService().cfx.getBalance(address, epochNumber);
    setBody(ctx, result)
}

// -----------------------------------tool---------------------------------------
function parseGatewayParam(ctx) {
    const {E_SPACE_OPENAPI: {MODULE, ACTION}} = CONST;
    mustBeEnumParamIfPresent(ctx.request.query, 'module', Object.values(MODULE) as string[]);
    mustBeEnumParamIfPresent(ctx.request.query, 'action', Object.values(ACTION) as string[]);

    const {module, action} = ctx.request.query
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

function setBody(ctx, result: any, status = "1", message = 'OK') {
    ctx.body = {status, message, result}
}

// -----------------------------------router---------------------------------------
export function registerRouter(router: Router) {
    router.get('/api', gateway)

    // nft assets
    router.get('/nft/balances', listNFTBalances);
    router.get('/nft/tokens', listNFTTokens);
    router.get('/nft/preview', getNFTPreview);

    // account(deprecated)
    router.get('/account/transactions', listAccountTransaction)
    router.get('/account/cfx/transfers', listAccountCfxTransfer)
    router.get('/account/crc20/transfers', listAccountTransfer20)
    router.get('/account/crc721/transfers', listAccountTransfer721)
    router.get('/account/crc1155/transfers', listAccountTransfer1155)
    router.get('/account/tokens', listAccountAssets)
}
