import {paginateCore} from "../../stat/router/ParamChecker";
import {mustBeAddressParamIfPresent} from "../../stat/service/common/utils";
import {StatApp} from "../../stat/StatApp";
import {listAuthAction} from "../../stat/model/EIP7702model";
import {getAccountQuery} from "../../stat/service/AccountQuery";
import {setBody} from "../router/middleware";

export async function listGlobalAuthAction(ctx) {
    const {skip, limit} = paginateCore(ctx.request.query)
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'author', 'address', 'txSender');
    const {author, address, txSender} = ctx.request.query;
    const result = await listAuthAction({author, address, txSender, skip, limit});
    setBody(ctx, result);
}
