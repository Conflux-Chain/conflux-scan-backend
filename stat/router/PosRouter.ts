import * as Router from "koa-router";
import {StatApp} from "../StatApp";
import {pickNumber} from "../model/Utils";
import {skipLimit, skipLimitAny} from "./ParamChecker";

export function registerPosRouter(router: Router<any, {}>, statApp: StatApp) {
    router.get('/top-pos-account-by-reward', async (ctx)=>{
        const page = await statApp.posQuery.listPosAccount({sortBy: 'totalReward', limit: 100})
        ctx.body = {
            code: 0, message: 'ok',
            list: page.rows, total: page.count,
        }
    })
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
        const {count: total, rows: list} = await statApp.posQuery.listPosAccountReward({identifier, skip, limit});
        ctx.body = {
            code: 0, total, list, listLimit:10_000,
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
    router.get('/list-pos-block', async (ctx)=>{
        // const {identifier} = ctx.request.query
        const {skip,limit} = skipLimitAny(ctx.request.query)
        const {count: total, rows: list} = await statApp.posQuery.listBlock({skip, limit});
        ctx.body = {
            code: 0, total, list
        }
    })
    router.get('/list-pos-tx', async (ctx)=>{
        // const {identifier} = ctx.request.query
        const {skip,limit} = skipLimitAny(ctx.request.query)
        const {count: total, rows: list} = await statApp.posQuery.listTx({skip, limit});
        ctx.body = {
            code: 0, total, list
        }
    })
    router.get('/list-account-vote-history', async (ctx)=>{
        const {identifier} = ctx.request.query
        const {skip,limit} = skipLimit(ctx.request.query)
        const {count: total, rows: list} = await statApp.posQuery.listAccountVoteHistory({skip, limit, identifier});
        ctx.body = {
            code: 0, total, list, listLimit:10_000,
        }
    })
    router.get('/list-pos-committee', async (ctx)=>{
        const {skip,limit} = skipLimit(ctx.request.query)
        const {count: total, rows: list} = await statApp.posQuery.listCommittee({skip, limit});
        ctx.body = {
            code: 0, total, list
        }
    })
    router.get('/list-tx-by-pos-height', async (ctx)=>{
        const {skip,limit} = skipLimit(ctx.request.query)
        const {height} = ctx.request.query;
        const {count: total, rows: list} = await statApp.posQuery.listTxInBlock({skip, limit, blockHeight: height});
        ctx.body = { code: 0, total, list }
    })
    router.get('/list-pos-daily-stat', async (ctx)=>{
        const {skip,limit} = skipLimit(ctx.request.query)
        const {count: total, rows: list} = await statApp.posQuery.listPosDailyStat({skip, limit});
        ctx.body = { code: 0, total, list }
    })
}