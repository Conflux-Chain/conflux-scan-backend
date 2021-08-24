import * as Koa from 'koa'
import {ApiServer, getApiService} from '../ApiServer'
import * as Router from "koa-router";
import {pageParam} from "../../stat/service/common/utils";
import {
    CODE_PARAMETER_ABSENT,
    CODE_PARAMETER_ABSENT_MSG,
    CODE_PARAMETER_ERROR,
    CODE_PARAMETER_ERROR_MSG
} from "../common/Def";
import {KnownError} from "../common/RestTool";
import {base32id} from "../service/OpenTxService";
import {BalanceService} from "../../stat/service/watcher/BalanceService";
import {koaSwagger} from "koa2-swagger-ui";
import * as path from "path";
const yamljs = require('yamljs');

const cors = require('@koa/cors');

function skipLimit(obj) {
    return pageParam(obj, 'skip', 'limit', 10)
}

async function root(ctx, tag) {
    ctx.body = {code: 0, message: `Conflux Scan Open Api 0.1 ${tag}`}
}

function setBody(ctx, data: any, code = 0, message = 'ok') {
    ctx.body = {code, message, data}
}

/**
 * Query asserts hold by one account/address.
 * @param ctx
 */
async function listAccountAssert(ctx) {
    const {account: base32} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
        return
    }
    const asserts = await BalanceService.listAccountBalanceInner(base32)
    setBody(ctx, asserts)
}
/**
 * query transactions of one account(address)
 * @param ctx
 */
async function listAccountTransaction(ctx) {
    const {skip, limit} = skipLimit(ctx.request.query)
    const {account: base32,startEpoch,endEpoch,startTimestamp,endTimestamp,sort} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
        return
    }
    const page = await getApiService().fullBlockQuery.listTransaction({accountAddress: base32, skip, limit,
        verboseAddress: false
    });
    page.list?.forEach(tx=>{
        delete tx.syncTimestamp
    })
    delete page.extraInfo
    setBody(ctx, page)
}

/**
 * Query crc20 transfer of one account(address)
 * @param ctx
 */
async function listAccountTransfer20(ctx) {
    const {skip, limit} = skipLimit(ctx.request.query)
    const {account: base32,startEpoch,endEpoch,startTimestamp,endTimestamp,sort,contract} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
        return
    }
    const page = await getApiService().crc20transferQuery.listTransfer(
        {accountAddress:base32, address: contract, skip, limit}
    );
    setBody(ctx, page)
}

/**
 * Query crc721 transfer of one account(address)
 * @param ctx
 */
async function listAccountTransfer721(ctx) {
    const {skip, limit} = skipLimit(ctx.request.query)
    const {account: base32,startEpoch,endEpoch,startTimestamp,endTimestamp,sort,contractAddress,tokenId} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
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
    const {account: base32,startEpoch,endEpoch,startTimestamp,endTimestamp,sort,contractAddress,tokenId} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
        return
    }
    const hexId = await base32id(base32)
    const page = await getApiService().crc1155transferQuery.listTransfer(
        {accountAddress:base32, address:contractAddress, skip, limit, tokenId}
    );
    page['hexId'] = hexId
    setBody(ctx, page)
}
function addSwagger(app: Koa, router: Router<any, {}>, prefix) {
    const docPath = `${prefix}/doc`
    let apiDef = '/open-api.yaml';
    const pwd = path.resolve('.')
    console.log(`pwd is ${pwd}`)
    const spec = yamljs.load('./document/open-api.yaml');
    app.use(
        koaSwagger({
            routePrefix: docPath,
            oauthOptions: {},
            swaggerOptions: {
                // url: `${prefix}${apiDef}`,
                title: 'open-api-doc',
                spec
            },
        }),
    );
}
export async function register(app: Koa, apiServer: ApiServer) {
    app.use(cors({'origin':'*'}))
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
    const prefix = '/open';
    getApiService().logger.info(`url prefix: ${prefix}`)
    const router = new Router({prefix: prefix})
    let middleware = router.routes();
    app.use(middleware)
    addSwagger(app, router, prefix)

    router.get('/', async (ctx)=>{
        return root(ctx, apiServer.config.serverTag)
    })
    router.get('/transaction/account', listAccountTransaction)
    router.get('/transfer20/account', listAccountTransfer20)
    router.get('/transfer721/account', listAccountTransfer721)
    router.get('/transfer1155/account', listAccountTransfer1155)
    router.get('/account/assert', listAccountAssert)
}
