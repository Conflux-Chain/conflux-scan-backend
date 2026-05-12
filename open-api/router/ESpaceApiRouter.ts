import * as Router from "koa-router";
import {Drip, format} from "js-conflux-sdk";
import {getApiService} from "../ApiServer";
import {StatApp} from "../../stat/StatApp";
import {FailedTx, FullTransaction} from "../../stat/model/FullBlock";
import {closestEpochByTimeStamp, ClosestType} from "../../stat/model/Epoch";
import {setBody} from "./middleware";
import {
    listAccountAssets, listAccountInfos,
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
    listNFTTransfers,
    listAccountTransfer,
} from "../service/OpenTransferService";
import {
    getABI,
    getSourceCode,
    verifySourcecode,
    checkVerifyStatus,
    verifyProxyContract,
    checkProxyVerification,
    getContractCreation,
} from "../service/OpenContractService";
import {
    getToken,
    listTokens,
    validERC20Token,
} from "../service/OpenTokenService";
import {
    listAccountNFTs,
    listNFTTokensPro,
    getNFTPreview,
    listNFTTokensByFts,
    listNFTOwners,
} from "../service/OpenNFTService";
import {
    getSupplyStat,
    listAccountActiveStats,
    listAccountGrowthStats, listApproval,
    listCfxHolderStats,
    listCfxReceiverTopStat,
    listCfxSenderTopStat,
    listCfxTransferStat, listCIP1559Stats,
    listContractStats,
    listGasUsedTopStat,
    listMinerTopStat,
    listCoreMiningStat, listTokenHolderStat,
    listTokenParticipantTopStat,
    listTokenReceiverTopStat,
    listTokenSenderTopStat,
    listTokenTransferStat,
    listTokenTransferTopStat, listTokenUniqueParticipantStat, listTokenUniqueReceiverStat, listTokenUniqueSenderStat,
    listTpsStats,
    listTransactionReceiverTopStat, listTransactionSenderStat,
    listTransactionSenderTopStat,
    listCoreTransactionStat,
} from "../service/OpenStatService";
import {
    calCount,
    checkPresent,
    mustBeAddressParamIfPresent, mustBeDateParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeHex64ParamIfPresent,
    mustBeIntParamIfPresent,
    INTERVAL_TYPE,
} from "../../stat/service/common/utils";
import {LIMIT_MAX_STAT, paginateEVM} from "../../stat/router/ParamChecker";
import {CONST} from '../../stat/service/common/constant';
import {ethers} from "ethers";
import {CIP1559StatType} from "../../stat/service/StatsQuery";
import {registerDataApi} from "./ApiRouter";
import {detectAccountType} from "../../stat/service/eip/eip7702";
import {Errors} from "../../stat/service/common/LogicError";
import {TokenQuery, TokenType} from "../../stat/service/TokenQuery";
import {NFTType} from "../../stat/service/nftchecker/NFTCheckerService";
import {HomepageDashboard} from "../../stat/service/HomepageDashboard";
import {list4337Tx, listBundledTx, listGlobalAuthAction, getBundleTxDetail} from "../service/OpenEIPService";

const lodash = require('lodash');

const EPOCH_NUMBER_LABEL_ARRAY = ['latest_mined', 'latest_state', 'latest_finalized', 'latest_confirmed',
    'latest_checkpoint', 'earliest'];
// -----------------------------------biz---------------------------------------
// 2024.1.24 format as checksum address
function checksum_hexAddress(addr: string) {
    return addr ? ethers.getAddress(format.hexAddress(addr)) : addr
}
async function gateway(ctx) {
    const {E_SPACE_OPENAPI: {ACCOUNT, CONTRACT, TRANSACTION, BLOCK, LOGS, TOKEN, STATS}} = CONST;
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
                case ACCOUNT.action.TOKEN_1155_TX:
                    handler = listTransfer1155;
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
                case ACCOUNT.action.ADDRESS_TOKEN_BALANCE:
                    handler = listAddressTokenBalance;
                    break;
                case ACCOUNT.action.ADDRESS_TOKEN_NFT_BALANCE:
                    handler = listAddressTokenNFTBalance;
                    break;
                case ACCOUNT.action.ADDRESS_TOKEN_NFT_INVENTORY:
                    handler = listAddressTokenInventory;
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
                case CONTRACT.action.GET_CONTRACT_CREATION:
                    handler = getContractCreation;
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
        case LOGS.module:
            switch (action) {
                case LOGS.action.GET_LOGS:
                    handler = listLogs;
                    break;
                default:
                    return Promise.reject(`unknown action:${action} of module:${module}`);
            }
            break;
        case TOKEN.module:
            switch (action) {
                case TOKEN.action.TOKEN_HOLDER_LIST:
                    handler = listTokenHolders;
                    break;
                case TOKEN.action.TOKEN_HOLDER_COUNT:
                    handler = getTokenHolderCount;
                    break;
                case TOKEN.action.TOP_HOLDERS:
                    handler = listTokenTopHolders;
                    break;
                case TOKEN.action.TOKEN_INFO:
                    handler = getTokenInfo;
                    break;
                default:
                    return Promise.reject(`unknown action:${action} of module:${module}`);
            }
            break;
        case STATS.module:
            switch (action) {
                case STATS.action.CFX_SUPPLY:
                    handler = getCfxSupply;
                    break;
                case STATS.action.CFX_PRICE:
                    handler = getCfxPrice;
                    break;
                case STATS.action.TOKEN_SUPPLY:
                    handler = getTokenSupply;
                    break;
                case STATS.action.TOKEN_SUPPLY_HISTORY:
                    handler = getTokenSupplyHistory;
                    break;
                case STATS.action.DAILY_BLOCK:
                    handler = listDailyBlock;
                    break;
                case STATS.action.DAILY_TX:
                    handler = listDailyTx;
                    break;
                case STATS.action.DAILY_TX_FEE:
                    handler = listDailyTxnFee;
                    break;
                case STATS.action.DAILY_NEW_ADDRESS:
                    handler = listDailyNewAddress;
                    break;
                case STATS.action.DAILY_AVG_HASHRATE:
                    handler = listDailyAvgHashrate;
                    break;
                case STATS.action.DAILY_AVG_DIFFICULTY:
                    handler = listDailyAvgDifficulty;
                    break;
                case STATS.action.DAILY_AVG_BLOCKTIME:
                    handler = listDailyAvgBlockTime;
                    break;
                case STATS.action.DAILY_AVG_GASLIMIT:
                    handler = listDailyAvgGasLimit;
                    break;
                case STATS.action.DAILY_TOTAL_GASUSED:
                    handler = listDailyTotalGasUsed;
                    break;
                case STATS.action.DAILY_AVG_GASPRICE:
                    handler = listDailyAvgGasPrice;
                    break;
                case STATS.action.DAILY_NETWORK_UTILIZATION:
                    handler = listDailyNetworkUtilization;
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
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
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
            from: checksum_hexAddress(item.from),
            to: item.to ? checksum_hexAddress(item.to) : '',
            value: item.value,
            gas: '',
            gasPrice: item.gasPrice,
            isError: item.status === 0 ? '0' : '1',
            txreceipt_status: item.status === 0 ? '1' : '0',
            input: '',
            contractAddress: item.contractCreated? checksum_hexAddress(item.contractCreated) : '',
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
        from: checksum_hexAddress(item.from),
        to: checksum_hexAddress(item.to),
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
    return listAddressTransfer(
        ctx,
        getApiService().crc20transferQuery,
        (item: any) => ({
            blockNumber: `${item.epochNumber}`,
            hash: item.transactionHash,
            timestamp: `${item.timestamp}`,
            from: checksum_hexAddress(item.from),
            to: checksum_hexAddress(item.to),
            contractAddress: checksum_hexAddress(item.address),
            value: item.value,
        }),
    );
}

async function listTransfer721(ctx) {
    return listAddressTransfer(
        ctx,
        getApiService().crc721transferQuery,
        (item: any) => ({
            blockNumber: `${item.epochNumber}`,
            hash: item.transactionHash,
            timestamp: `${item.timestamp}`,
            from: checksum_hexAddress(item.from),
            to: checksum_hexAddress(item.to),
            contractAddress: checksum_hexAddress(item.address),
            tokenID: `${item.tokenId}`,
        }),
    );
}

async function listTransfer1155(ctx) {
    return listAddressTransfer(
        ctx,
        getApiService().crc1155transferQuery,
        (item: any) => ({
            blockNumber: `${item.epochNumber}`,
            hash: item.transactionHash,
            timestamp: `${item.timestamp}`,
            from: checksum_hexAddress(item.from),
            to: checksum_hexAddress(item.to),
            contractAddress: checksum_hexAddress(item.address),
            tokenID: `${item.tokenId}`,
            tokenValue: item.value,
        }),
    );
}

async function listAddressTransfer(ctx, queryFunc, converterFunc) {
    const {contractaddress, address, startblock, endblock, sort, page, offset} = parseListTransferParam(ctx);
    if(contractaddress === undefined && address === undefined){
        throw new Error(`The contractaddress and/or address parameters are required.`);
    }

    const skip = (page - 1) * offset;
    const pagedTransfers = await queryFunc.listTransfer({ accountAddress: address,
        address: contractaddress, minEpochNumber: startblock, maxEpochNumber: endblock, sort, skip, limit: offset});

    let result = pagedTransfers?.list?.map(converterFunc) || [];

    await addTokenBasicInfo(result);

    setBody(ctx, result)
}

async function listBlock(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
    mustBeEnumParamIfPresent(ctx.request.query, 'blocktype', ['blocks']);
    mustBeIntParamIfPresent(ctx.request.query, 'page', 'offset');
    const {address} = ctx.request.query;
    checkPresent({address}, ['address']);

    const {page, offset} = paginateEVM(ctx.request.query);

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
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
    mustBeIntParamIfPresent(ctx.request.query, 'blockno');
    const {address, blockno: epochNumber} = ctx.request.query;
    checkPresent({address, blockno: epochNumber}, ['address', 'blockno']);

    let result;
    try{
        result = await getApiService().cfx.getBalance(address, epochNumber);
    } catch (e){
        // code: -32602,
        // message: 'Invalid parameters: num',
        // data: '"Specified epoch 226979060 is not executed, the latest state epoch is 134633298"'
        throw new Errors.ParameterError(`${e?.data ? e.data : e?.message}`);
    }

    setBody(ctx, result)
}

async function getTokenBalance(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractaddress', 'address');
    const {contractaddress, address} = ctx.request.query;
    checkPresent({contractaddress, address}, ['contractaddress', 'address']);
    await validERC20Token(contractaddress);

    const result = await getApiService().tokenTool.getTokenBalance(contractaddress, address, undefined, true);
    checkError(result);
    setBody(ctx, result)
}

function checkError(resultOrError: Error | any) {
    if (resultOrError instanceof Error) {
        throw resultOrError;
    }
}

async function getTokenBalanceHistory(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractaddress', 'address');
    mustBeIntParamIfPresent(ctx.request.query, 'blockno');
    const {contractaddress, address, blockno: epochNumber} = ctx.request.query;
    checkPresent({contractaddress, address, blockno: epochNumber}, ['contractaddress', 'address', 'blockno']);
    await validERC20Token(contractaddress);

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

    const closestType = (closest === 'before' || closest === undefined) ? ClosestType.BEFORE : ClosestType.AFTER

    const epochNumber = await closestEpochByTimeStamp(closestType, timestamp)
    if(!lodash.isNumber(epochNumber)){
        setBody(ctx, undefined, 1, `blockno ${closest} timestamp ${timestamp} not found` )
        return;
    }

    setBody(ctx, epochNumber)
}

async function listLogs(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
    mustBeHex64ParamIfPresent(ctx.request.query, 'topic0', 'topic1', 'topic2', 'topic3');
    let {
        fromBlock, toBlock, address,
        topic0, topic1, topic2, topic3,
    } = ctx.request.query;

    // hack code: just used for hardhat verify plugin
    if(fromBlock === "0" && toBlock === "latest") {
        const traceCreate = await getApiService().traceCreateQuery.query(address)
        const blockNumber = traceCreate.epochNumber
        fromBlock = blockNumber
        toBlock = blockNumber
    }

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
    const logArray = (await getApiService().eth?.getLogs(options)) || [];
    const result = logArray.slice(0, limit);
    setBody(ctx, result)
}

async function listTokenHolders(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractaddress');
    mustBeIntParamIfPresent(ctx.request.query, 'page', 'offset');

    const {contractaddress} = ctx.request.query;
    checkPresent({contractaddress}, ['contractaddress']);
    await validERC20Token(contractaddress);
    const {page, offset} = paginateEVM(ctx.request.query, {limit: 10});
    const skip = (page - 1) * offset;

    const data = await getApiService().balanceService.rankHolder(contractaddress, skip, offset)
    if(!data?.list) {
        setBody(ctx, [])
        return
    }

    const list = (data.list as any[])?.map(tokenBalance =>
        ({
            TokenHolderAddress: tokenBalance.account.address,
            TokenHolderQuantity: tokenBalance.balance,
        })
    )
    setBody(ctx, list)
}

async function getTokenHolderCount(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractaddress');

    const {contractaddress} = ctx.request.query;
    checkPresent({contractaddress}, ['contractaddress']);

    const token = await getApiService().tokenQuery.query({address: contractaddress})
    if(!token || token.transferType !== CONST.TRANSFER_TYPE.ERC20) {
        setBody(ctx, undefined, 1, `ERC20 token ${contractaddress} not found` )
        return;
    }

    setBody(ctx, token?.holderCount.toString() || 0)
}

const DEFAULT_TOP_HOLDERS = 100;
const MAX_TOP_HOLDERS = 1000;
async function listTokenTopHolders(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractaddress');
    mustBeIntParamIfPresent(ctx.request.query, 'offset');

    const {contractaddress, offset} = ctx.request.query;
    checkPresent({contractaddress}, ['contractaddress']);
    await validERC20Token(contractaddress);

    const limit = offset || DEFAULT_TOP_HOLDERS;
    if (limit > MAX_TOP_HOLDERS) {
        throw new Errors.ParameterError(`Parameter offset exceeds ${MAX_TOP_HOLDERS}`);
    }

    const data = await getApiService().balanceService.rankHolder(contractaddress, 0, limit)
    if(!data?.list) {
        setBody(ctx, [])
        return
    }

    const list = (data.list as any[])?.map(tokenBalance =>
        ({
            TokenHolderAddress: tokenBalance.account.address,
            TokenHolderQuantity: tokenBalance.balance,
        })
    )

    setBody(ctx, list)
}

async function getTokenInfo(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractaddress');
    const {contractaddress} = ctx.request.query;
    checkPresent({contractaddress}, ['contractaddress']);

    const token = await getToken(contractaddress);
    if(!token){
        throw new Errors.ParameterError(`Token ${contractaddress} not found.`);
    }

    const result = [token];
    setBody(ctx, result)
}

async function listAddressTokenBalance(ctx) {
    return listAddressTokens(
        ctx,
        [CONST.TRANSFER_TYPE.ERC20 as TokenType],
        (token: any) => ({
            TokenAddress: token.contract,
            TokenName: token.name,
            TokenSymbol: token.symbol,
            TokenQuantity: token.balance,
            TokenDivisor: token.decimals?.toString(),
            TokenPriceUSD: token.price,
        }),
    );
}

async function listAddressTokenNFTBalance(ctx) {
    return listAddressTokens(
        ctx,
        [CONST.TRANSFER_TYPE.ERC721 as TokenType],
        (token: any) => ({
            TokenAddress: token.contract,
            TokenName: token.name,
            TokenSymbol: token.symbol,
            TokenQuantity: token.balance,
        }),
    );
}

async function listAddressTokens(ctx, tokenTypes, converterFunc) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
    mustBeIntParamIfPresent(ctx.request.query, 'page', 'offset');

    const {address} = ctx.request.query;
    const {page, offset} = paginateEVM(ctx.request.query);
    const skip = (page - 1) * offset;

    checkPresent({address}, ['address']);

    const result = await TokenQuery.listByAccount({
        owner: address,
        skip,
        limit: offset,
        types: tokenTypes,
    });

    result.list = result.list.map(converterFunc);

    result.list = result.list.map(token => lodash.pickBy(token, value => !lodash.isNil(value)));

    setBody(ctx, result.list)
}

async function listAddressTokenInventory(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address', 'contractaddress');
    mustBeIntParamIfPresent(ctx.request.query, 'page', 'offset');

    const {address: owner, contractaddress: contract} = ctx.request.query;
    const {page, offset} = paginateEVM(ctx.request.query);
    const skip = (page - 1) * offset;

    checkPresent({owner}, ['owner']);

    if(contract) {
        const typeInfo = await TokenQuery.detectTokenType({base32: contract})
        if(typeInfo?.type !== CONST.TRANSFER_TYPE.ERC721) {
            throw new Errors.ParameterError(`Contract ${contract} not ERC721 token`);
        }
    }

    const result = await getApiService().nftCheckerService.listNftTokensForOpenApiPro({owner, contract, skip,
        limit: offset, type: CONST.TRANSFER_TYPE.ERC721 as NFTType});

    result.list = result.list.map((nft: any) => ({
        TokenAddress: nft.contract,
        TokenId: nft.tokenId,
    }))

    setBody(ctx, result.list)
}

async function getCfxSupply(ctx) {
    const {totalEspaceTokens} = HomepageDashboard.getData()?.supplyInfo as any;
    setBody(ctx, totalEspaceTokens);
}

async function getCfxPrice(ctx) {
    setBody(ctx, {
        cfxbtc: `${TokenQuery.wrappedCFX.price / TokenQuery.wrappedBTC.price}`,
        cfxbtc_timestamp: `${TokenQuery.wrappedBTC['updatedAt'].getTime() / 1000}`,
        cfxusd: TokenQuery.wrappedCFX.price,
        cfxusd_timestamp: `${TokenQuery.wrappedCFX['updatedAt'].getTime() / 1000}`,
    });
}

async function getTokenSupply(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractaddress');
    const {contractaddress} = ctx.request.query;
    checkPresent({contractaddress}, ['contractaddress']);
    await validERC20Token(contractaddress);

    const result = await getApiService().tokenTool.getTokenTotalSupply(contractaddress, undefined, true);
    checkError(result);
    setBody(ctx, result);
}

async function getTokenSupplyHistory(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractaddress');
    mustBeIntParamIfPresent(ctx.request.query, 'blockno');
    const {contractaddress, blockno: epochNumber} = ctx.request.query;
    checkPresent({contractaddress, blockno: epochNumber}, ['contractaddress', 'blockno']);
    await validERC20Token(contractaddress);

    let result = await getApiService().tokenTool.getTokenTotalSupply(contractaddress, epochNumber, true);
    checkError(result);
    result = result === undefined ? '0' : result;
    setBody(ctx, result)
}

async function listDailyBlock(ctx) {
    return listEvmMiningStat(ctx, (item: any) => ({
        blockCount: parseInt(item.blockCount),
    }))
}

async function listDailyTx(ctx) {
    return listEvmTransactionStat(ctx, (item: any) => ({
        transactionCount: parseInt(item.txCount),
    }));
}

async function listDailyTxnFee(ctx) {
    return listEvmTransactionStat(ctx, (item: any) => ({
        transactionFee_CFX: new Drip(item.gasFee).toCFX(),
    }));
}

async function listDailyAvgHashrate(ctx) {
    return listEvmMiningStat(ctx, (item: any) => ({
        networkHashRate: item.hashRate,
    }))
}

async function listDailyAvgDifficulty(ctx) {
    return listEvmMiningStat(ctx, (item: any) => ({
        networkDifficulty: item.difficulty,
    }))
}

async function listDailyAvgBlockTime(ctx) {
    return listEvmMiningStat(ctx, (item: any) => ({
        blockTime_sec: item.blockTime,
    }))
}

async function listDailyAvgGasLimit(ctx) {
    return listEvmGasStat(ctx, (item: any) => ({
        gasLimit: item.gasLimitAvg,
    }))
}

async function listDailyTotalGasUsed(ctx) {
    return listEvmGasStat(ctx, (item: any) => ({
        gasUsed: item.gasUsedSum,
    }))
}

async function listDailyAvgGasPrice(ctx) {
    return listEvmGasStat(ctx, (item: any) => ({
        maxGasPrice_Drip: item.gasPriceMax,
        minGasPrice_Drip: item.gasPriceMin,
        avgGasPrice_Drip: item.gasPriceAvg,
    }))
}

async function listDailyNetworkUtilization(ctx) {
    return listEvmGasStat(ctx, (item: any) => ({
        networkUtilization: item.networkUtilization,
    }))
}

async function listDailyNewAddress(ctx) {
    return listEvmStat(ctx, (params) => {
        return getApiService().statsQuery.listAccountGrowthStats(params);
    }, {}, (item: any) => ({
        newAddressCount: item.count,
    }));
}

async function listEvmMiningStat(ctx, fieldMapper) {
    return listEvmStat(ctx, (params) => {
        return getApiService().statsQuery.listBlockDataStats(params);
    }, {
        attributeArray: ['statTime', 'blockTime', ['hashrate', 'hashRate'], 'difficulty', 'blockCount'],
        intervalType: INTERVAL_TYPE.day,
    }, fieldMapper);
}

async function listEvmTransactionStat(ctx, fieldMapper) {
    return listEvmStat(ctx, (params) => {
        return getApiService().statsQuery.listDailyTransactionStats(params);
    }, {
        attributes: [['statDay', 'statTime'], 'txCount', 'gasFee'],
    }, fieldMapper);
}

async function listEvmGasStat(ctx, fieldMapper) {
    return listEvmStat(ctx, (params) => {
        return getApiService().statsQuery.listGasStats(params);
    }, {}, fieldMapper);
}

async function listEvmStat(ctx, func, params, fieldMapper) {
    const {minTimestamp, maxTimestamp, sort, recordCount} = parseStatParam(ctx)

    const page = await func({
        minTimestamp,
        maxTimestamp,
        skip: 0,
        limit: recordCount,
        sort,
        ...params,
    });
    console.log(`listEvmStat ${JSON.stringify(page.list)}`)

    const list = page.list.map((item: any) => ({
        UTCDate: item.statTime.substr(0, 10),
        unixTimeStamp: `${new Date(item.statTime).getTime() / 1000}`,
        ...fieldMapper(item),
    }));

    setBody(ctx, list)
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
    mustBeHex64ParamIfPresent(ctx.request.query, 'txhash');
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractaddress', 'address');
    mustBeIntParamIfPresent(ctx.request.query, 'page', 'offset', 'startblock', 'endblock');
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['asc', 'desc']);
    const {page, offset} = paginateEVM(ctx.request.query);
    const {txhash, contractaddress, address, startblock, endblock, sort} = ctx.request.query;
    return {txhash, contractaddress, address, startblock, endblock, sort, page, offset};
}

function parseStatParam(ctx) {
    mustBeDateParamIfPresent(ctx.request.query, 'startdate', 'enddate');
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['asc', 'desc']);

    const {startdate, enddate, sort = 'desc'} = ctx.request.query;

    checkPresent({startdate, enddate}, ['startdate', 'enddate']);

    const minTimestamp = new Date(startdate).getTime() / 1000;
    const maxTimestamp = new Date(enddate).getTime() / 1000;
    if(maxTimestamp <= minTimestamp) {
        throw new Errors.ParameterError('Invalid date parameter. Should enddate > startdate');
    }

    const recordCount = calCount({
        minTimestampUTC: minTimestamp,
        maxTimestampUTC: maxTimestamp,
        intervalType: INTERVAL_TYPE.day,
    });
    if(recordCount > LIMIT_MAX_STAT) {
        throw new Errors.ParameterError(`Invalid date parameter. Maximum ${LIMIT_MAX_STAT} records`);
    }

    return {startdate, enddate, sort, minTimestamp, maxTimestamp, recordCount};
}

async function addTokenBasicInfo(result) {
    const addresses = result.map(item => item.contractAddress);
    const tokenArray = await getApiService().tokenQuery.list({addresses}).then(response => response.list);
    const tokenMap = lodash.keyBy(tokenArray, item => checksum_hexAddress(item.address));
    result.forEach(item => {
        const {name, symbol, decimals, transferType} = tokenMap[item.contractAddress] || {} as any;
        if(name) {
            item['tokenName'] = name;
        }
        if(symbol) {
            item['tokenSymbol'] = symbol;
        }
        if(transferType !== CONST.TRANSFER_TYPE.ERC1155) {
            item['tokenDecimal'] = `${decimals || 0}`;
        }
    });
}

// -----------------------------------router---------------------------------------
export function registerRouter(router: Router) {
    router.get('/api', gateway)
    router.post('/api', gateway)

    // nft assets
    router.get('/nft/balances', listAccountNFTs);
    router.get('/nft/tokens', listNFTTokensPro);
    router.get('/nft/preview', getNFTPreview);
    router.get('/nft/fts', listNFTTokensByFts);
    router.get('/nft/owners', listNFTOwners);
    router.get('/nft/transfers', listNFTTransfers);

    // utils
    router.get('/util/detectAccountType', (async ctx=>{
        const result = await detectAccountType(ctx.query.hex || ctx.query.account);
        setBody(ctx, result);
    }));
    router.get('/util/decode/method', abiDecode);
    router.get('/util/decode/method/raw', abiDecodeRaw);

    // statistics
    router.get('/statistics/supply', getSupplyStat);
    router.get('/statistics/mining', listCoreMiningStat)
    router.get('/statistics/tps', listTpsStats);
    router.get('/statistics/contract', listContractStats);
    router.get('/statistics/account/cfx/holder', listCfxHolderStats);
    router.get('/statistics/account/growth', listAccountGrowthStats);
    router.get('/statistics/account/active', listTransactionSenderStat);
    router.get('/statistics/account/active/overall', listAccountActiveStats);
    router.get('/statistics/transaction', listCoreTransactionStat);
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
    router.get('/statistics/block/base-fee', listCIP1559Stats(CIP1559StatType.BASE_FEE));
    router.get('/statistics/block/avg-priority-fee', listCIP1559Stats(CIP1559StatType.PRIORITY_FEE));
    router.get('/statistics/block/gas-used', listCIP1559Stats(CIP1559StatType.GAS_USED));
    router.get('/statistics/block/txs-by-type', listCIP1559Stats(CIP1559StatType.TXS_BY_TYPE));

    // account
    router.get('/account/transactions', listAccountTransaction)
    router.get('/account/cfx/transfers', listAccountCfxTransfer)
    router.get('/account/crc20/transfers', listAccountTransfer20)
    router.get('/account/crc721/transfers', listAccountTransfer721)
    router.get('/account/crc1155/transfers', listAccountTransfer1155)
    router.get('/account/crc3525/transfers', listAccountTransfer3525)
    router.get('/account/erc20/transfers', listAccountTransfer20)
    router.get('/account/erc721/transfers', listAccountTransfer721)
    router.get('/account/erc1155/transfers', listAccountTransfer1155)
    router.get('/account/erc3525/transfers', listAccountTransfer3525)
    router.get('/account/transfers', listAccountTransfer)
    router.get('/account/approvals', listApproval)
    router.get('/account/tokens', listAccountAssets)
    router.get('/account/infos', listAccountInfos)

    // token
    router.get('/token/tokeninfos', listTokens);

    //eip7702
    router.get('/eip7702/auths', listGlobalAuthAction);
    router.get('/eip4337/bundle-txs', listBundledTx);
    router.get('/eip4337/aa-txs', list4337Tx);
    router.get('/eip4337/bundle-tx', getBundleTxDetail);

    registerDataApi(router)
}
