import {setBody} from "../router/middleware";
import {CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG} from "../common/Def";
import {skipLimit} from "../../stat/service/common/utils";

export function polishTransferList(page) {
    page?.list?.forEach(row=>{
        row.contract = row.address
        row.amount = row.value
        delete row.transactionLogIndex
        delete row.syncTimestamp
        delete row.transferType
        delete row.address
        delete row.value
    })
}

export async function listTransfer(ctx, service) {
    const {skip, limit} = skipLimit(ctx.request.query)
    const {account: base32,minEpochNumber, maxEpochNumber, minTimestamp, maxTimestamp, from, to,sort,contract,tokenId} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
        return
    }
    const page = await service.listTransfer(
        {accountAddress:base32, address:contract, skip, limit, tokenId,
            minEpochNumber, maxEpochNumber, minTimestamp, maxTimestamp, from, to, sort}
    );
    polishTransferList(page)
    setBody(ctx, page)
}