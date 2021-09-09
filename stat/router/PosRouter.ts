import * as Router from "koa-router";
import {StatApp} from "../StatApp";
import {pickNumber} from "../model/Utils";

export function registerPosRouter(router: Router<any, {}>, statApp: StatApp) {
    router.get('/list-pos-account', async (ctx)=>{
        const limit = pickNumber(parseInt(ctx.request.query.limit), 10)
        const skip = pickNumber(parseInt(ctx.request.query.skip), 0)
        const p = {...ctx.request.query, skip, limit, groupByPowAddress: Boolean(ctx.request.query.groupByPowAddress)}
        const page = await statApp.posQuery.listPosAccount(p)
        ctx.body = {
            code: 0, message: 'ok',
            data: {
                list: page.rows,
                total: page.count
            }
        }
    })
}