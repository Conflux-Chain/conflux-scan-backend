import {paginateCore, SKIP_MAX} from "../../stat/router/ParamChecker";
import {mustBeAddressParamIfPresent, mustBeHex64ParamIfPresent, getCfxSdk} from "../../stat/service/common/utils";
import {StatApp} from "../../stat/StatApp";
import {listAuthAction} from "../../stat/model/EIP7702model";
import {getAccountQuery} from "../../stat/service/AccountQuery";
import {setBody} from "../router/middleware";
import {queryAATx, queryBundleTx, fillAATxMethodInfo, getAATxDetail as fetchAATxDetail, fetchMethodsByUserOpHashes} from "../../stat/service/eip/eip4337query";
import {getAddrId} from "../../stat/model/HexMap";
import {parseBundleTxByHash} from "../../stat/service/eip/eip4337bundleParser";
import {Errors} from "../../stat/service/common/LogicError";


function assertSkipWithinLimit(skip: number) {
    if (skip >= SKIP_MAX) {
        throw new Errors.ParameterError(`Parameter <skip> exceeds listLimit (${SKIP_MAX})`);
    }
}

export async function listGlobalAuthAction(ctx) {
    const {skip, limit} = paginateCore(ctx.request.query)
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'author', 'address', 'txSender');
    assertSkipWithinLimit(skip);
    const {author, address, txSender} = ctx.request.query;
    const result = await listAuthAction({author, address, txSender, skip, limit});
    setBody(ctx, {...result, listLimit: SKIP_MAX});
}

export async function listBundledTx(ctx) {
    const {skip, limit} = paginateCore(ctx.request.query)
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'bundler', 'entryPoint');
    assertSkipWithinLimit(skip);
    const {bundler, entryPoint} = ctx.request.query;

    const result = await queryBundleTx({
        bundlerId: bundler ? ((await getAddrId(bundler)) ?? -1) : undefined,
        entryPointId: entryPoint ? ((await getAddrId(entryPoint)) ?? -1) : undefined,
        skip, limit,
    });

    setBody(ctx, {...result, listLimit: SKIP_MAX});
}

export async function list4337Tx(ctx) {
    const {skip, limit} = paginateCore(ctx.request.query)
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'bundler', 'entryPoint', 'sender');
    assertSkipWithinLimit(skip);
    const {bundler, entryPoint, sender} = ctx.request.query;

    const result = await queryAATx({
        bundlerId: bundler ? (await getAddrId(bundler) ?? -1) : undefined,
        entryPointId: entryPoint ? (await getAddrId(entryPoint) ?? -1) : undefined,
        senderId: sender ? (await getAddrId(sender, undefined) ?? -1) : undefined,
        skip, limit,
    });

    await fillAATxMethodInfo(result.list);

    setBody(ctx, {...result, listLimit: SKIP_MAX});
}

export async function getAATxDetail(ctx) {
    const {userOpHash} = ctx.request.query;
    if (!userOpHash) {
        throw new Errors.ParameterError('param <userOpHash> is required');
    }
    mustBeHex64ParamIfPresent(ctx.request.query, 'userOpHash');

    const detail = await fetchAATxDetail(getCfxSdk(), userOpHash);
    setBody(ctx, detail ?? null);
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

    // Enrich each user op with parsedMethods resolved from the DB.
    const hashes = result.userOps.map(op => op.userOpHash).filter(Boolean);
    if (hashes.length > 0) {
        const methodsMap = await fetchMethodsByUserOpHashes(hashes);
        const stubs = result.userOps.map(op => ({ userOpHash: op.userOpHash, methods: methodsMap.get(op.userOpHash) ?? '' }));
        await fillAATxMethodInfo(stubs);
        stubs.forEach((stub, i) => { result.userOps[i].parsedMethods = stub.parsedMethods ?? []; });
    }

    setBody(ctx, result);
}
