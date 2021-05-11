import {StatApp} from "../StatApp";
import * as Koa from 'koa'
import {Context} from 'koa'
import * as helmet from 'koa-helmet'
import * as Router from 'koa-router'
import {KEY_MINER_EPOCH, KEY_TX_EPOCH, KV} from "../model/KV";
import {TxnQuery} from "../service/TxnQuery";
import {koaSwagger} from "koa2-swagger-ui";
import ApiDef from "./ApiDef";
import {addDevopsRouter} from "./DevopsRouter";
import {pickNumber} from "../model/Utils";
import {DailyToken, NftId, Token} from "../model/Token";
import {T_DAILY_TOKEN_TXN} from "../model/Erc20Transfer";
import {DailyCfxTxn} from "../model/CfxTransfer";

const cors = require('@koa/cors');
import Application = require("koa");
import {QueryTypes} from "sequelize";
import {AddressStat, DailyActiveAddress} from "../model/StatAddress";

const superagent = require('superagent');

export const ROUTER_PREFIX = '/stat'
function addRoute(router: Router<any, {}>, statApp: StatApp) {
    router.get('/server-info', async (ctx: Context) => {
        ctx.body = {
            code: 0, message: `Conflux-Stat 2021.04.08 ${statApp.config.serverTag} network id ${StatApp.networkId}`
        }
    })
    router.get('/contract/all', async (ctx)=>{
        ctx.body = {
            list: [...statApp.contractService.map.values()]
        }
    })
    router.get('/account-token-balance', async(ctx) => {
        const {base32, tokenType} = ctx.request.query
        const list = await statApp.balanceService.listAccountBalance(base32, tokenType)
        ctx.body = {code: 0, list}
    })
    router.get('/tokens/nft-token-id-count', async (ctx)=>{
        // const render  = ctx.request.query.render
        const groupList = await NftId.sequelize.query(`select token.name, token.symbol, t.contractHexId, 
 hex40.hex, token.type, t.cnt from (select count(*) as cnt, contractHexId from nft_id
 group by contractHexId) t 
 left join token on token.hex40id = t.contractHexId
 left join hex40 on hex40.id=t.contractHexId`,{
            type: QueryTypes.SELECT
        })

        ctx.body = {
            list: groupList
        }
    })
    router.get('/tokens/erc1155/balance-of', async (ctx)=>{
        const addr = ctx.request.query.address
        const resp = await statApp.balanceService.getERC1155balance(addr)
        ctx.body = resp
    })
    router.get('/tokens/daily-token-txn', async (ctx)=>{
        let limit = Math.min(1000, parseInt(ctx.request.query.limit || 1000));
        const sql = `select day, max(updatedAt) as updatedAt, sum(txnCount) as txnCount
            from ${T_DAILY_TOKEN_TXN} group by day order by day desc limit ?`
        const list = await statApp.sequelize.query(sql,
            {type: QueryTypes.SELECT, replacements:[limit]}
            ).catch(err=>{
                console.log(`${ctx.request.url} fail:`, err)
            })
        ctx.body = {code:0, list}
    })
    router.get('/tokens/holder-rank', async (ctx)=>{
        const base32 = ctx.request.query.address
        const limit = pickNumber(parseInt(ctx.request.query.limit), 10)
        const skip = pickNumber(parseInt(ctx.request.query.skip), 0)
        ctx.body = {
            ...(await statApp.balanceService.rankHolder(base32, skip, limit))
        }
    })
    router.get('/tokens/by-address', async (ctx)=>{
        const res = await new Promise((resolve) => {
            // front end use lower case and without type.contract
            const tokenAddr = ctx.request.query.address
            const addr = tokenAddr.toLowerCase()
            superagent.get(`${statApp.config.scanApiUrl}/v1/token/${addr}`)
                .query(ctx.request.querystring)
                .end(async (err, res)=>{
                    if (err) {
                        console.log(`scan api fetch token fail:`, err)
                        ctx.body = res.body
                        ctx.status = 600
                        resolve("fail")
                        return
                    }
                    if (res.status === 200) {
                      res.body.holderCount = (await statApp.balanceService.getHolderCount(addr)) || '-'
                    }
                    ctx.body = res.body
                    resolve("ok")
                })
        })
    })
    router.get('/tokens/list', async (ctx)=>{
        await new Promise(async r=>{
            // superagent.get(`${statApp.config.scanApiUrl}/v1/token`)
            //     .query(ctx.request.querystring).end(async (err, base)=>{
            //     if (base.status !== 200) {
            //         ctx.body = base
            //         ctx.status = base.status;
            //         r('fail')
            //         return;
            //     }
            //     base =  JSON.parse(base.text)
            //     // console.log(`base data:`, JSON.stringify(base))
            //     const localTokenList = await statApp.balanceService.listToken();
            //     const map = new Map()
            //     localTokenList.forEach(t=>map.set(t.base32.substr(t.base32.lastIndexOf(':')).toLowerCase(), t))
            //     base.list.forEach(baseToken=>{
            //         baseToken.holderCount = '-'
            //         const info = map.get(baseToken.address.substr(baseToken.address.lastIndexOf(':')).toLowerCase())
            //         info && (baseToken.holderCount = info.holder)
            //         if (info && info.name === '') {
            //             // it's really bad to do it here.
            //             Token.update({name: baseToken.name},{where: {id: info.id}})
            //                 .catch()
            //         }
            //     })
            //
            //     ctx.body = base
            //     r('ok')
            // })
            const {fields, transferType, orderBy, reverse, skip, limit} = ctx.request.query;
            const page = await statApp.tokenSync.listToken(fields, transferType, orderBy, reverse, skip? parseInt(skip): skip,
                limit ? parseInt(limit): limit);
            const result: any = {};
            if(page){
                result.total = page.count;
                result.list = page.rows;
            }
            ctx.body = result;
            r('ok')
        }).catch(err=>{
            ctx.body = {
                code: 500,
                message: `${err}`
            }
        })
    })
    //top gas used
    router.get('/top-gas-used', async (ctx)=>{
        ctx.body = await TxnQuery.topByGasUsed(ctx.request.query, statApp.sequelize)
    })
    //
    router.get('/top-cfx-holder', async (ctx)=>{
        const rank = statApp.rankService
        const {type, limit} = ctx.request.query || {type: 'cfxSend', limit: 10};
        ctx.body = await rank.top(type, parseInt(limit), StatApp.networkId)
    })
    // miner topN
    router.get('/miner/top-by-type', async (ctx)=>{
        const blockService = statApp.blockAndMinerSync;
        const { span, type, rows } = ctx.request.query;
        const {list,allDifficulty} = await blockService.topByType(parseInt(span), type, parseInt(rows || 10));
        const timeRange = blockService.calculateTimeRange(list);
        const seconds = blockService.calculateHashRate(list, timeRange.beginTime, timeRange.endTime);
        ctx.body = {
            code: 0, message: 'ok',
            list,
            allDifficulty,
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
        const top = await txnSync.txTopBy(span, type, parseInt(rows), action, StatApp.networkId);
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
        const page = await new TxnQuery().listTxn({from},
            parseInt(skip), parseInt(limit), StatApp.networkId)
        ctx.body = {code: 0, data: page};
    })
    // daily address creation.
    router.get('/daily-address-creation', async function (ctx) {
        let limit = parseInt(ctx.request.query.limit || 1000);
        const list = await AddressStat.findAll({limit: Math.min(limit,1000), order:[['day','DESC']]})
        ctx.body = {code:0, list}
    })
    // daily active address.
    router.get('/daily-active-address', async function (ctx) {
        let limit = parseInt(ctx.request.query.limit || 1000);
        const list = await DailyActiveAddress.findAll({limit: Math.min(limit,1000), order:[['day','DESC']]})
        ctx.body = {code:0, list}
    })
    // daily token stat
    router.get('/daily-token-stat', async function (ctx) {
        let limit = parseInt(ctx.request.query.limit || 1000);
        const base32 = ctx.request.query.base32 || ''
        const token = await Token.findOne({where: {base32: base32}})
        if (!token) {
            ctx.body = {code: 404, message: `token not found ${base32}`}
            return
        }
        const list = await DailyToken.findAll({limit: Math.min(limit,1000), order:[['day','DESC']],
            where: {hexId: token.hex40id}})
        ctx.body = {code:0, list}
    })
    // daily cfx transfer count
    router.get('/daily-cfx-txn', async function (ctx) {
        let limit = parseInt(ctx.request.query.limit || 1000);
        const list = await DailyCfxTxn.findAll({limit: Math.min(limit,1000), order:[['day','DESC']]})
        ctx.body = {code:0, list}
    })
    // daily tx count
    router.get('/txn/daily/list', async function (ctx) {
        const {skip, limit} = ctx.request.query
        const page = await statApp.dailyTxnQuery.listTxnDaily(skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);
        ctx.body = {code: 0, data: page};
    });
    // daily cfx holder count
    router.get('/cfx_holder/daily/list', async function (ctx) {
        const {skip, limit} = ctx.request.query
        const page = await statApp.cfxHolderQuery.listCfxHolderDaily(skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);
        ctx.body = {code: 0, data: page};
    });
    // daily contract count
    router.get('/contract/daily/list', async function (ctx) {
        const {skip, limit} = ctx.request.query
        const page = await statApp.contractCreateQuery.listContractCreateDaily(skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);
        ctx.body = {code: 0, data: page};
    });
    // get creat trace
    router.get('/trace/create', async function (ctx) {
        const {contract} = ctx.request.query
        const createTrace = await statApp.traceCreateQuery.getCreateTrace(contract);
        ctx.body = {code: 0, data: createTrace};
    });
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