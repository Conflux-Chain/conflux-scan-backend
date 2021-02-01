import {StatApp} from "../StatApp";
import * as Koa from 'koa'
import { Context } from 'koa'
const cors = require('@koa/cors');
import * as helmet from 'koa-helmet'
import * as Router from 'koa-router'
import {KEY_MINER_EPOCH, KEY_TX_EPOCH, KV} from "../model/KV";
import {TxnQuery} from "../service/TxnQuery";

function addRoute(router: Router<any, {}>, statApp: StatApp) {
    router.get('/server-info', async (ctx: Context) => {
        ctx.body = {
            code: 0, message: 'Conflux-Stat 2021.01.15'
        }
    })
    // miner topN
    router.get('/top-by-type', async (ctx)=>{
        const blockService = statApp.blockAndMinerSync;
        const { span, type, rows } = ctx.request.query;
        const list = await blockService.topByType(span, type, rows);
        const timeRange = blockService.calculateTimeRange(list);
        const seconds = blockService.calculateHashRate(list, timeRange.beginTime, timeRange.endTime);
        ctx.body = {
            list,
            ...timeRange,
            seconds,
            total: list.length,
        };
    })
    // tx topN
    router.get('/tx/top-by-type', async function (ctx) {
        const txnSync = statApp.txnSync;
        const { span, type, rows, action } = ctx.request.query;
        // action: cfxSend/Receive; txnSend/Receive
        const top = await txnSync.txTopBy(span, type, rows, action);
        ctx.body =  {
            ...top,
        };
    });
    // sync info
    router.get('/sync-info', async (ctx)=>{
        const tx = await KV.getNumber(KEY_TX_EPOCH);
        const miner = await KV.getNumber(KEY_MINER_EPOCH);
        ctx.body = {
            txEpoch: tx,
            minerEpoch: miner,
            chainEpoch: await statApp.blockAndMinerSync.cfx.getEpochNumber()
        };
    });
    //
    router.get('/txn/list', async function (ctx) {
        const {from, skip, limit} = ctx.request.query
        const page = await new TxnQuery().listTxn({from}, parseInt(skip), parseInt(limit))
        ctx.body = {code: 0, data: page};
    })
}

export function register(app:Koa, statApp: StatApp) {
    const router = new Router({ })

    addRoute(router, statApp);

    app.use(helmet())
    app.use(cors())
    let middleware = router.routes();
    app.use(middleware)
    console.log('router registered.')
}