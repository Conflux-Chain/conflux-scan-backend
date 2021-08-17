import * as Koa from 'koa'
import {ApiServer, getApiService} from '../ApiServer'
import * as Router from "koa-router";
import {pageParam} from "../../stat/service/common/utils";
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
async function listAccountTransaction(ctx) {
    const {skip, limit} = skipLimit(ctx.request)
    const {address: base32} = ctx.request;
    const page = await getApiService().fullBlockQuery.listTransaction({accountAddress: base32, skip, limit})
    setBody(ctx, page )
}
export async function register(app:Koa, apiServer:ApiServer) {
    app.use(cors())
    app.use(async (ctx, next) =>{
        await next().catch(err=>{
            setBody(ctx, undefined, 500, err.toString())
            getApiService().logger.error(`api error ${ctx.request.url}?${ctx.request.querystring}`, err)
        })
    })
    const router = new Router({ prefix: '/api' })
    let middleware = router.routes();
    app.use(middleware)

    router.get('/', root)
    router.get('/list-account-transaction', listAccountTransaction)
}