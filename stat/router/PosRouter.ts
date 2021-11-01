import * as Router from "koa-router";
import {StatApp} from "../StatApp";
import {pickNumber} from "../model/Utils";
import {skipLimit} from "./ParamChecker";

export function registerPosRouter(router: Router<any, {}>, statApp: StatApp) {
    router.get('/list-pos-account', async (ctx)=>{
        const limit = pickNumber(parseInt(ctx.request.query.limit), 10)
        const skip = pickNumber(parseInt(ctx.request.query.skip), 0)
        const p = {...ctx.request.query, skip, limit,
            groupByPowAddress: Boolean(ctx.request.query.groupByPowAddress)
        }
        const page = await statApp.posQuery.listPosAccountWithCurrentCommittee(p)
        ctx.body = {
            code: 0, message: 'ok',
            list: page.rows,
            total: page.count,
        }
    })
    router.get('/list-pos-account-reward', async (ctx)=>{
        const {identifier} = ctx.request.query
        const {skip,limit} = skipLimit(ctx.request.query)
        ctx.body = {
            code: 0, ...await statApp.posQuery.listPosAccountReward({identifier, skip, limit})
        }
    })
    router.get('/pos-account-detail', async (ctx)=>{
        const {identifier} = ctx.request.query
        ctx.body = {
            code: 0, ...await statApp.posQuery.getAccountDetail(identifier)
        }
    })
    router.get('/pos-info', async (ctx)=>{
        ctx.body = await statApp.posQuery.posInfo()
    })

}