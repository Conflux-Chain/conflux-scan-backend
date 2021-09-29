import * as Koa from 'koa'
import {ApiServer, getApiService} from '../ApiServer'
import * as Router from "koa-router";
import {
    CODE_PARAMETER_ABSENT,
    CODE_PARAMETER_ABSENT_MSG,
} from "../common/Def";
import {BalanceService} from "../../stat/service/watcher/BalanceService";
import {addSwagger, executionTime, handleException, rateControl, setBody} from "./middleware";
import {listTransfer, polishTransferList} from "../service/OpenTransferService";
import {
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent,
    skipLimit
} from "../../stat/service/common/utils";
import {polishAssertList} from "../service/OpenAccountService";
import {polishContract} from "../service/OpenContractService";
import {StatApp} from "../../stat/StatApp";

const cors = require('@koa/cors');

async function root(ctx, tag) {
    ctx.body = {code: 0, message: `Conflux Scan Open Api 0.1 ${tag}`}
}

/**
 * Query asserts hold by one account/address.
 * @param ctx
 */
async function listAccountAssets(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'account')
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])
    const {account: base32} = ctx.request.query;
    // if (!Boolean(base32)) {
    //     setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
    //     return
    // }
    const assets = await BalanceService.listAccountBalanceInner(base32)
    polishAssertList(assets)
    setBody(ctx, assets)
}
async function getChainStatus(ctx) {
    const {skip,limit} = skipLimit(ctx.request.query)
    if (skip > 60) {
        throw new Error('Parameter <skip> exceeds 60')
    }
    if (limit > 60) {
        throw new Error('Parameter <limit> exceeds 60')
    }
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['min','hour','day'])
    const {intervalType, sort} = ctx.request.query
    const page = await getApiService().dailyBlockDataStatQuery.listStat(intervalType, skip, limit,
        (sort || 'desc').toLowerCase())
    setBody(ctx, page)
}
/**
 * query transactions of one account(address)
 * @param ctx
 */
async function listAccountTransaction(ctx) {
    mustBeIntParamIfPresent(ctx.request.query, 'minEpochNumber','maxEpochNumber','minTimestamp','maxTimestamp')
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'from','to','account')
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])
    const {skip, limit} = skipLimit(ctx.request.query)
    const {account: base32,minEpochNumber,maxEpochNumber,minTimestamp,maxTimestamp,from, to, sort, nonce, txType, needAddressInfo} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
        return
    }
    const page = await getApiService().fullBlockQuery.listTransaction({accountAddress: base32, skip, limit,
        verboseAddress: false, minEpochNumber, maxEpochNumber, minTimestamp, maxTimestamp, from, to, sort, nonce, txType
    });
    page?.list?.forEach(tx=>{
        delete tx.syncTimestamp
        delete tx.blockHash
    })
    delete page.extraInfo
    await polishContract(page, needAddressInfo)
    setBody(ctx, page)
}
async function listAccountCfxTransfer(ctx) {
    return listTransfer(ctx, getApiService().cfxTransferQuery)
}
/**
 * Query crc20 transfer of one account(address)
 * @param ctx
 */
async function listAccountTransfer20(ctx) {
    return listTransfer(ctx, getApiService().crc20transferQuery)
}

/**
 * Query crc721 transfer of one account(address)
 * @param ctx
 */
async function listAccountTransfer721(ctx) {
    return listTransfer(ctx, getApiService().crc721transferQuery)
}

/**
 * Query crc1155 transfer of one account(address)
 * @param ctx
 */
async function listAccountTransfer1155(ctx) {
    return listTransfer(ctx, getApiService().crc1155transferQuery)
}

export async function register(app: Koa, apiServer: ApiServer) {
    app.use(cors({'origin':'*'}))
    app.use(executionTime)
    // app.use(rateControl)
    app.use(handleException)
    const prefix = '/open';
    addSwagger(app, prefix)
    getApiService().logger.info(`url prefix: ${prefix}`)
    const router = new Router({prefix: prefix})
    let middleware = router.routes();
    app.use(middleware)

    router.get('/', async (ctx)=>{
        return root(ctx, apiServer.config.serverTag)
    })
    router.get('/favicon.ico', (ctx) => ctx.status = 204/*No Content*/);
    router.get('/version', (ctx)=>{
        ctx.body = {code: 0, message: 'ok',
            data: {
                version: '0.0.1'
            }
        }
    })
    //
    router.get('/chain/status', getChainStatus)
    //
    router.get('/account/transactions', listAccountTransaction)
    router.get('/account/cfx/transfers', listAccountCfxTransfer)
    router.get('/account/crc20/transfers', listAccountTransfer20)
    router.get('/account/crc721/transfers', listAccountTransfer721)
    router.get('/account/crc1155/transfers', listAccountTransfer1155)
    router.get('/account/tokens', listAccountAssets)
}
