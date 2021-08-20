import * as Koa from 'koa'
import {ApiServer, getApiService} from '../ApiServer'
import * as Router from "koa-router";
import {pageParam} from "../../stat/service/common/utils";
import {
    CODE_ACCOUNT_ADDRESS_ABSENT,
    CODE_ACCOUNT_ADDRESS_ABSENT_MSG,
    CODE_PARAMETER_ERROR,
    CODE_PARAMETER_ERROR_MSG
} from "../common/Def";
import {KnownError} from "../common/RestTool";
import {base32id} from "../service/OpenTxService";

const cors = require('@koa/cors');

function skipLimit(obj) {
    return pageParam(obj, 'skip', 'limit', 10)
}

async function root(ctx) {
    ctx.body = {code: 0, message: 'Conflux Scan Open Api 0.1'}
}

function setBody(ctx, data: any, code = 0, message = 'ok') {
    ctx.body = {code, message, data}
}

/**
 * query transactions of one account(address)
 * @param ctx
 */
async function listAccountTransaction(ctx) {
    const {skip, limit} = skipLimit(ctx.request.query)
    const {address: base32,startEpoch,endEpoch,startTimestamp,endTimestamp,sort} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_ACCOUNT_ADDRESS_ABSENT, CODE_ACCOUNT_ADDRESS_ABSENT_MSG+":address")
        return
    }
    const page = await getApiService().fullBlockQuery.listTransaction({accountAddress: base32, skip, limit});
    setBody(ctx, page)
}

/**
 * Query crc20 transfer of one account(address)
 * @param ctx
 */
async function listAccountTransfer20(ctx) {
    const {skip, limit} = skipLimit(ctx.request.query)
    const {address: base32,startEpoch,endEpoch,startTimestamp,endTimestamp,sort,contractAddress} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_ACCOUNT_ADDRESS_ABSENT, CODE_ACCOUNT_ADDRESS_ABSENT_MSG+":address")
        return
    }
    const page = await getApiService().crc20transferQuery.listTransfer(
        {accountAddress:base32, address: contractAddress, skip, limit}
    );
    setBody(ctx, page)
}

/**
 * Query crc721 transfer of one account(address)
 * @param ctx
 */
async function listAccountTransfer721(ctx) {
    const {skip, limit} = skipLimit(ctx.request.query)
    const {address: base32,startEpoch,endEpoch,startTimestamp,endTimestamp,sort,contractAddress,tokenId} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_ACCOUNT_ADDRESS_ABSENT, CODE_ACCOUNT_ADDRESS_ABSENT_MSG+":address")
        return
    }
    const page = await getApiService().crc721transferQuery.listTransfer(
        {accountAddress:base32, address:contractAddress, skip, limit, tokenId}
    );
    setBody(ctx, page)
}

/**
 * Query crc1155 transfer of one account(address)
 * @param ctx
 */
async function listAccountTransfer1155(ctx) {
    const {skip, limit} = skipLimit(ctx.request.query)
    const {address: base32,startEpoch,endEpoch,startTimestamp,endTimestamp,sort,contractAddress,tokenId} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_ACCOUNT_ADDRESS_ABSENT, CODE_ACCOUNT_ADDRESS_ABSENT_MSG+":address")
        return
    }
    const hexId = await base32id(base32)
    const page = await getApiService().crc1155transferQuery.listTransfer(
        {accountAddress:base32, address:contractAddress, skip, limit, tokenId}
    );
    page['hexId'] = hexId
    setBody(ctx, page)
}

export async function register(app: Koa, apiServer: ApiServer) {
    app.use(cors())
    app.use(async (ctx, next) => {
        await next().catch(err => {
            if (err instanceof KnownError) {
                return
            }
            if (err.message.includes('path="", not match "hex40"')) {
                setBody(ctx, ctx.request.query, CODE_PARAMETER_ERROR, CODE_PARAMETER_ERROR_MSG)
                return
            }
            setBody(ctx, undefined, 500, err.toString())
            console.log((typeof err))
            getApiService().logger.error(`api error ${ctx.request.url}`, err)
        })
    })
    const router = new Router({prefix: '/api'})
    let middleware = router.routes();
    app.use(middleware)

    router.get('/', root)
    router.get('/list-account-transaction', listAccountTransaction)
    router.get('/list-account-transfer20', listAccountTransfer20)
    router.get('/list-account-transfer721', listAccountTransfer721)
    router.get('/list-account-transfer1155', listAccountTransfer1155)
}