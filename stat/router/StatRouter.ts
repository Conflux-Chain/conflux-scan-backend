import {StatApp} from "../StatApp";
import * as Koa from 'koa'
import { Context } from 'koa'
const cors = require('@koa/cors');
import * as helmet from 'koa-helmet'
import * as Router from 'koa-router'
import {KEY_MINER_EPOCH, KEY_TX_EPOCH, KV} from "../model/KV";
import {TxnQuery} from "../service/TxnQuery";
import Application = require("koa");
import {koaSwagger} from "koa2-swagger-ui";
import ApiDef from "./ApiDef";
const superagent = require('superagent');
import {addDevopsRouter} from "./DevopsRouter";
import {pickNumber} from "../model/Utils";
export const ROUTER_PREFIX = '/stat'
function addRoute(router: Router<any, {}>, statApp: StatApp) {
    router.get('/server-info', async (ctx: Context) => {
        ctx.body = {
            code: 0, message: `Conflux-Stat 2021.01.15 ${statApp.config.serverTag}`
        }
    })
    router.get('/tokens/holder-rank', async (ctx)=>{
        const base32 = ctx.request.query.address
        const limit = pickNumber(parseInt(ctx.request.query.limit), 10)
        const skip = pickNumber(parseInt(ctx.request.query.skip), 0)
        ctx.body = {
            ...(await statApp.balanceService.rankHolder(base32, skip, limit))
        }
    })
    router.get('/tokens/list', async (ctx)=>{
        await new Promise(r=>{
            superagent.get(`${statApp.config.scanApiUrl}/v1/token`)
                .query(ctx.request.querystring).end(async (err, base)=>{
                if (base.status !== 200) {
                    ctx.body = base
                    ctx.status = base.status;
                    r('fail')
                    return;
                }
                base =  JSON.parse(base.text)
                // console.log(`base data:`, JSON.stringify(base))
                const localTokenList = await statApp.balanceService.listToken();
                const map = new Map()
                localTokenList.forEach(t=>map.set(t.base32, t))
                base.list.forEach(baseToken=>{
                    baseToken.holderCount = '-'
                    const info = map.get(baseToken.address)
                    if (info != null){
                        baseToken.holderCount = baseToken.holder
                        baseToken.testProp = 1
                    }
                })
                ctx.body = base
                r('ok')
            })
        })
    })
    router.get('/top-cfx-holder', async (ctx)=>{
        const rank = statApp.rankService
        const {type, limit} = ctx.request.query || {type: 'cfxSend', limit: 10};
        // @ts-ignore
        let networkId = statApp.cfx.networkId;
        ctx.body = await rank.top(type, parseInt(limit), networkId)
    })
    // miner topN
    router.get('/miner/top-by-type', async (ctx)=>{
        const blockService = statApp.blockAndMinerSync;
        const { span, type, rows } = ctx.request.query;
        const list = await blockService.topByType(parseInt(span), type, parseInt(rows || 10));
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
        // @ts-ignore
        let networkId = statApp.cfx.networkId;
        const top = await txnSync.txTopBy(span, type, parseInt(rows), action, networkId);
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
        // @ts-ignore
        let networkId = statApp.cfx.networkId;
        const page = await new TxnQuery().listTxn({from},
            parseInt(skip), parseInt(limit), networkId)
        ctx.body = {code: 0, data: page};
    })
}

function addSwagger(app: Application, router: Router<any, {}>) {
    const docPath = `${ROUTER_PREFIX}/api-doc-stat`
    let apiDef = '/swagger.json.conf'; // .conf avoid frontend nginx interceptor.
    app.use(
        koaSwagger({
            routePrefix: docPath,
            oauthOptions: {},
            swaggerOptions: {
                url: `${ROUTER_PREFIX}${apiDef}`,
                title: 'statistic-api-doc'
            },
        }),
    );
    router.get(apiDef, async (ctx)=>{
        ctx.body = ApiDef
    })
    // router.use((ctx,next)=>{
        // ctx.set("script-src 'self'", 'sha256-bLIba9y02h2X9/32+3oS/4EmGe/+1HjpiNUBsaTTIGY=')
    // })
}

export function register(app:Koa, statApp: StatApp) {
    const router = new Router({ prefix: '/stat' })
    router.use(async (ctx, next)=>{
        try {
            await next();
        } catch (e) {
            console.log(`error occur:`, e)
            ctx.body = {code: 500, message: `Error: ${e}`}
        }
    })
    addRoute(router, statApp);

    const trusted = [
        "'self'",
    ];
    app.use(helmet({contentSecurityPolicy: {directives:{
                defaultSrc: trusted,
                scriptSrc: ['https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/3.38.0/swagger-ui-bundle.js',
                    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/3.38.0/swagger-ui-standalone-preset.js', 'unsafe-inline', "'unsafe-inline'"],
                styleSrc: ['https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/3.38.0/swagger-ui.min.css', "'unsafe-inline'",
                    'https://fonts.googleapis.com/css'],
                fontSrc: [ 'https:', "'unsafe-inline'", 'https://fonts.gstatic.com/s/opensans/v18/mem8YaGs126MiZpBA-UFWJ0bf8pkAp6a.woff2'],
                imgSrc: ['data:', 'https:', 'localhost', 'http://localhost:8086/favicon.png']
            }}}))
    app.use(cors())
    let middleware = router.routes();
    app.use(middleware)
    addSwagger(app, router)
    addDevopsRouter(router, statApp)
    console.log('router registered.')
}