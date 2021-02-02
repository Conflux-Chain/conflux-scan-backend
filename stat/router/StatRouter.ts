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
import {addDevopsRouter} from "./DevopsRouter";
export const ROUTER_PREFIX = '/stat'
function addRoute(router: Router<any, {}>, statApp: StatApp) {
    router.get('/server-info', async (ctx: Context) => {
        ctx.body = {
            code: 0, message: 'Conflux-Stat 2021.01.15'
        }
    })
    router.get('/top-cfx-holder', async (ctx)=>{
        const rank = statApp.rankService
        const {type, limit} = ctx.request.query || 10;
        // @ts-ignore
        let networkId = statApp.cfx.networkId;
        ctx.body = await rank.top(type, parseInt(limit), networkId)
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

function addSwagger(app: Application, router: Router<any, {}>) {
    const docPath = `${ROUTER_PREFIX}/api-doc-stat`
    let apiDef = '/swagger.json';
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