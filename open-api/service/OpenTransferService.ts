import {setBody} from "../router/middleware";
import {CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG} from "../common/Def";
import {
    checkPresent,
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent,
    skipLimit
} from "../../stat/service/common/utils";
import {polishContract} from "./OpenContractService";
import {StatApp} from "../../stat/StatApp";
import {getApiService} from "../ApiServer";
import {CONST} from "../../stat/service/common/constant";
import {TokenQuery} from "../../stat/service/TokenQuery";
import {paginateCore} from "../../stat/router/ParamChecker";
const lodash = require('lodash');

export async function listAccountCfxTransfer(ctx) {
    return listTransfer(ctx, getApiService().cfxTransferQuery)
}
/**
 * Query crc20 transfer of one account(address)
 * @param ctx
 */
export async function listAccountTransfer20(ctx) {
    return listTransfer(ctx, getApiService().crc20transferQuery)
}

/**
 * Query crc721 transfer of one account(address)
 * @param ctx
 */
export async function listAccountTransfer721(ctx) {
    return listTransfer(ctx, getApiService().crc721transferQuery)
}

/**
 * Query crc1155 transfer of one account(address)
 * @param ctx
 */
export async function listAccountTransfer1155(ctx) {
    return listTransfer(ctx, getApiService().crc1155transferQuery)
}

export async function listAccountTransfer3525(ctx) {
    return listTransfer(ctx, getApiService().crc3525transferQuery)
}

/**
 * Query all transfer of one account(address)
 * @param ctx
 */
export async function listAccountTransfer(ctx) {
    return listTransfer(ctx, getApiService().addrTransferQuery)
}

export async function listNFTTransfers(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contract');
    mustBeIntParamIfPresent(ctx.request.query, 'cursor');

    let {contract, cursor} = ctx.request.query;
    checkPresent({contract}, ['contract']);

    let service;
    const {type} = await TokenQuery.detectTokenType({base32: contract});
    switch (type) {
        case CONST.TRANSFER_TYPE.ERC721:
            service = getApiService().crc721transferQuery;
            break;
        case CONST.TRANSFER_TYPE.ERC1155:
            service = getApiService().crc1155transferQuery;
            break;
        case CONST.TRANSFER_TYPE.ERC3525:
            service = getApiService().crc3525transferQuery;
            break;
        default:
            throw new Error(`The contract ${contract} not a NFT contract`);
    }

    cursor = cursor === undefined ? 0 : cursor;
    return listTransfer(ctx, service, cursor);
}

export function polishTransferList(page) {
    page?.list?.forEach(row=>{
        row.contract = row.address
        row.amount = row.value
        delete row.blockPosition
        delete row.transactionIndex
        delete row.transactionLogIndex
        delete row.syncTimestamp
        delete row.transferType
        delete row.address
        delete row.value
        if (StatApp.isEVM) {
            row['blockNumber'] = row.epochNumber
            delete row.epochNumber;
            delete row.blockIndex;
            delete row.storageFee;
            delete row.contractAddress;
        }
    })
    delete page?.accountId
}

export async function listTransfer(ctx, service, cursor = undefined) {
    mustBeIntParamIfPresent(ctx.request.query, 'minEpochNumber','maxEpochNumber', 'startBlock', 'endBlock', 'minTimestamp','maxTimestamp')
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'from','to','account', 'contract')
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])
    mustBeEnumParamIfPresent(ctx.request.query, 'transferType', lodash.map(Object.values(CONST.ADDRESS_TRANSFER_TYPE), item => item.name))

    const {skip, limit} = paginateCore(ctx.request.query)
    // token id is not used in crc20transfer.
    const {account: base32, minEpochNumber, maxEpochNumber, startBlock, endBlock, minTimestamp, maxTimestamp, from, to,
        sort, contract, tokenId, transferType} = ctx.request.query;
    if (!Boolean(base32) && (cursor === undefined)) {
        setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
        return
    }

    const startEpoch = StatApp.isEVM ? startBlock : minEpochNumber;
    const endEpoch = StatApp.isEVM ? endBlock : maxEpochNumber;
    const page = await service.listTransfer(
        {accountAddress:base32, tokenArray: contract ? [contract] : undefined, skip, limit, tokenId, transferType,
            minEpochNumber: startEpoch, maxEpochNumber: endEpoch, minTimestamp, maxTimestamp, from, to, sort, cursor}
    );

    await polishContract(page)
    polishTransferList(page)
    setBody(ctx, page)
}