import {paginateCore} from "../../stat/router/ParamChecker";
import {mustBeAddressParamIfPresent, mustBeHex64ParamIfPresent, getCfxSdk} from "../../stat/service/common/utils";
import {StatApp} from "../../stat/StatApp";
import {listAuthAction} from "../../stat/model/EIP7702model";
import {getAccountQuery} from "../../stat/service/AccountQuery";
import {setBody} from "../router/middleware";
import {queryAATx, queryBundleTx} from "../../stat/service/eip/eip4337query";
import {getAddrId} from "../../stat/model/HexMap";
import {parseBundleTxByHash} from "../../stat/service/eip/eip4337bundleParser";
import {Errors} from "../../stat/service/common/LogicError";

export async function listGlobalAuthAction(ctx) {
    const {skip, limit} = paginateCore(ctx.request.query)
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'author', 'address', 'txSender');
    const {author, address, txSender} = ctx.request.query;
    const result = await listAuthAction({author, address, txSender, skip, limit});
    setBody(ctx, result);
}

export async function listBundledTx(ctx) {
    const {skip, limit} = paginateCore(ctx.request.query)
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'bundler', 'entryPoint');
    const {bundler, entryPoint} = ctx.request.query;

    const result = await queryBundleTx({
        bundlerId: bundler ? ((await getAddrId(bundler)) ?? -1) : undefined,
        entryPointId: entryPoint ? ((await getAddrId(entryPoint)) ?? -1) : undefined,
        skip, limit,
    });

    setBody(ctx, result);
}

export async function list4337Tx(ctx) {
    const {skip, limit} = paginateCore(ctx.request.query)
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'bundler', 'entryPoint', 'sender');
    const {bundler, entryPoint, sender} = ctx.request.query;

    const result = await queryAATx({
        bundlerId: bundler ? (await getAddrId(bundler) ?? -1) : undefined,
        entryPointId: entryPoint ? (await getAddrId(entryPoint) ?? -1) : undefined,
        senderId: sender ? (await getAddrId(sender, undefined) ?? -1) : undefined,
        skip, limit,
    });

    setBody(ctx, result);
}

export async function getBundleTxDetail(ctx) {
    const {txHash} = ctx.request.query;
    if (!txHash) {
        throw new Errors.ParameterError('param <txHash> is required');
    }
    mustBeHex64ParamIfPresent(ctx.request.query, 'txHash');

    const result = await parseBundleTxByHash(getCfxSdk(), txHash);

    if (!result) {
        throw new Errors.ParameterError(`Bundle tx not found or not a 4337 bundle: ${txHash}`);
    }

    setBody(ctx, result);
}
