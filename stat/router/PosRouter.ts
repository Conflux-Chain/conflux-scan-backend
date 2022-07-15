import * as Router from "koa-router";
import {StatApp} from "../StatApp";
import {pickNumber} from "../model/Utils";
import {skipLimit, skipLimitAny} from "./ParamChecker";
import {PosAccount, PosDailyStat, recentPosRewardRank} from "../model/PoS";
import {Drip} from "js-conflux-sdk";
import {
    BIZ,
    fetchDailyStatMix,
    limitListOnBody,
    PosDailyStatMix,
    queryDailyPosRewardAvgAccount,
    queryPosStatMix
} from "../service/pos/PosStat";
import {intParam, list2map, mustBeEnumParamIfPresent} from "../service/common/utils";
import {Op} from "sequelize";
import {queryPosRank} from "../service/pos/PosRewardRank";

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
            groupByPowAddress: Boolean(ctx.request.query.groupByPowAddress),
            sortBy: ctx.request.query.orderBy,
        }
        const page = await statApp.posQuery.listPosAccountWithCurrentCommittee(p)
        ctx.body = {
            code: 0, message: 'ok',
            list: page.rows,
            total: page.count,
        }
    })
    router.get('/list-pos-account-reward', async (ctx)=>{
        const {identifier, orderBy, reverse} = ctx.request.query
        const {skip,limit} = skipLimit(ctx.request.query)
        const {count: total, rows: list} = await statApp.posQuery.listPosAccountReward({identifier, skip, limit,
            orderBy: orderBy === 'createdAt' ? 'epoch' : orderBy, order: reverse === 'true' ? 'desc' : 'asc'});
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
        const {identifier,orderBy,reverse} = ctx.request.query
        const {skip,limit} = skipLimit(ctx.request.query)
        const {count: total, rows: list} = await statApp.posQuery.listAccountVoteHistory({skip, limit, identifier,
            orderBy: orderBy === 'createdAt' ? 'blockNumber' : orderBy, order: reverse === 'true' ? 'desc':'asc'});
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
    router.get('/pos-daily-staking', async (ctx)=>{
        const list = await PosDailyStat.findAll({attributes: ['stakingAmount','statDay'],
            order:[['statDay','asc']], raw: true})
        list.forEach(row=>{
            row['v'] = parseFloat(new Drip(row.stakingAmount.toString()).toCFX())
            delete row.stakingAmount
        })
        ctx.body = {code: 0, list, total: list.length}
        limitListOnBody(ctx)
    })
    router.get('/pos-daily-apy', async (ctx)=>{
        await fetchDailyStatMix('pos_apy', ctx)
    })
    router.get('/pos-daily-account', async (ctx)=>{
        await fetchDailyStatMix('account_count', ctx)
    })
    router.get('/pos-daily-finalize-gap', async (ctx)=>{
        await queryPosStatMix('finalize_epoch_gap','finalize_second_gap', ctx)
    })
    router.get('/pos-daily-total-reward', async (ctx)=>{
        await fetchDailyStatMix('pos_total_reward', ctx)
    })
    router.get('/pos-daily-deposit-withdraw', async (ctx)=>{
        await queryPosStatMix('staking_deposit','staking_withdraw', ctx, ` and day >= '2022-02-27' `)
    })
    router.get('/pos-daily-participation-rate', async (ctx)=>{
        await fetchDailyStatMix('participation_rate', ctx, new Date('2022-02-27'))
    })
    router.get('/pos-daily-reward', async (ctx)=>{
        await queryDailyPosRewardAvgAccount(ctx, new Date('2022-02-27'))
    })
    router.get('/pos-reward-rank', async (ctx)=>{
        const {skip, limit} = skipLimit(ctx.request.query)
        const {orderBy: rankField, reverse} = ctx.request.query
        const order = reverse == 'true' ? 'desc' : 'asc'
        ctx.body = await queryPosRank(rankField, order, skip, limit)
    })
    router.get('/pos-recent-reward-rank', async (ctx)=>{
        // deprecated
        const day = intParam(ctx.request.query, 'day', 1)
        const dt = new Date()
        dt.setDate(dt.getDate() - day)
        const list = await recentPosRewardRank(dt, 10)
        const accountList = await PosAccount.findAll({
            where: {id: {[Op.in]: list.map(row=>row.accountId)}}
        })
        const map = list2map(accountList, 'id')
        list.forEach(row=>{
            row["accountInfo"] = map.get(row.accountId)
        })
        ctx.body = {code: 0, list, total: list.length}
    })
    router.get('/list-pos-daily-stat', async (ctx)=>{
        const {skip,limit} = skipLimit(ctx.request.query)
        const {count: total, rows: list} = await statApp.posQuery.listPosDailyStat({skip, limit});
        ctx.body = { code: 0, total, list }
    })
}