import {setBody} from "../router/middleware";
import {CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG} from "../common/Def";
import {mustBeAddressParamIfPresent, mustBeIntParamIfPresent, skipLimit} from "../../stat/service/common/utils";
import {polishContract} from "./OpenContractService";

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
    })
    delete page?.accountId
}

export async function listTransfer(ctx, service) {
    mustBeIntParamIfPresent(ctx.request.query, 'minEpochNumber','maxEpochNumber','minTimestamp','maxTimestamp')
    mustBeAddressParamIfPresent(ctx.request.query, 'from','to','account')
    const {skip, limit} = skipLimit(ctx.request.query)
    // token id is not used in crc20transfer.
    const {account: base32,minEpochNumber, maxEpochNumber, minTimestamp, maxTimestamp, from, to,sort,contract,tokenId, needAddressInfo} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
        return
    }
    const page = await service.listTransfer(
        {accountAddress:base32, tokenArray: contract ? [contract] : undefined, skip, limit, tokenId,
            minEpochNumber, maxEpochNumber, minTimestamp, maxTimestamp, from, to, sort}
    );
    polishTransferList(page)
    await polishContract(page, needAddressInfo)
    setBody(ctx, page)
}