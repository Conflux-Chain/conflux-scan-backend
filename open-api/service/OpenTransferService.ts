import {setBody} from "../router/middleware";
import {CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG} from "../common/Def";
import {
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent,
    skipLimit
} from "../../stat/service/common/utils";
import {polishContract} from "./OpenContractService";
import {StatApp} from "../../stat/StatApp";
import {getApiService} from "../ApiServer";

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

/**
 * Query all transfer of one account(address)
 * @param ctx
 */
export async function listAccountTransfer(ctx) {
    return listTransfer(ctx, getApiService().addrTransferQuery)
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
        }
    })
    delete page?.accountId
}

export async function listTransfer(ctx, service) {
    mustBeIntParamIfPresent(ctx.request.query, 'minEpochNumber','maxEpochNumber', 'startBlock', 'endBlock', 'minTimestamp','maxTimestamp')
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'from','to','account', 'contract')
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])
    const {skip, limit} = skipLimit(ctx.request.query)
    // token id is not used in crc20transfer.
    const {account: base32,minEpochNumber, maxEpochNumber, startBlock, endBlock, minTimestamp, maxTimestamp, from, to,sort,contract,tokenId, needAddressInfo} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
        return
    }
    const startEpoch = StatApp.isEVM ? startBlock : minEpochNumber;
    const endEpoch = StatApp.isEVM ? endBlock : maxEpochNumber;
    const page = await service.listTransfer(
        {accountAddress:base32, tokenArray: contract ? [contract] : undefined, skip, limit, tokenId,
            minEpochNumber: startEpoch, maxEpochNumber: endEpoch, minTimestamp, maxTimestamp, from, to, sort}
    );
    polishTransferList(page)
    await polishContract(page, needAddressInfo)
    setBody(ctx, page)
}