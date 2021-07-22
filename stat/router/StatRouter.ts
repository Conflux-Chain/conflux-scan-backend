// @ts-ignore
import {format} from "js-conflux-sdk"
import {StatApp} from "../StatApp";
import * as Koa from 'koa'
import {Context} from 'koa'
import * as helmet from 'koa-helmet'
import * as Router from 'koa-router'
import bodyParser = require("koa-bodyparser");
import {KEY_MINER_EPOCH, KEY_TX_EPOCH, KV} from "../model/KV";
import {TxnQuery} from "../service/TxnQuery";
import {koaSwagger} from "koa2-swagger-ui";
import ApiDef from "./ApiDef";
import {addDevopsRouter} from "./DevopsRouter";
import {pickNumber} from "../model/Utils";
import {DailyToken, NftId, Token} from "../model/Token";
import {T_DAILY_TOKEN_TXN} from "../model/Erc20Transfer";
import {DailyCfxTxn, sumRecentCfxAmount, sumRecentCfxTxn} from "../model/CfxTransfer";
import Application = require("koa");
import {QueryTypes,Op} from "sequelize";
import {AddressStat, DailyActiveAddress} from "../model/StatAddress";
import {countRecentTokenTransfer, countRecentTokenTransferAccount} from "../service/DailyTxnSync";
import {countRecentMiner} from "../service/BlockAndMinerSync";
import {Hex40Map} from "../model/HexMap";
import {Epoch} from "../model/Epoch";
import {CfxBill} from "../service/watcher/DummyNode";
import {NFTMap} from "../service/nftchecker/NFTInfo";

const NodeCache = require( "node-cache" );
const cors = require('@koa/cors');

const dbCache = new NodeCache()
const cacheTtl = 60 * 10 // 10 minutes

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
        const sql = `select day, max(updatedAt) as updatedAt, sum(txnCount) as txnCount,
                sum(userCount) as userCount
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
        const {fields, currency, address} = ctx.request.query;
        const result = await statApp.tokenQuery.query(address,fields, currency);
        ctx.body = result || {};
    })

    router.get('/contract/by-address', async (ctx)=>{
        const {fields, address} = ctx.request.query;
        console.log(`fields---------${JSON.stringify(fields)},address---------------${address}`)
        const result = await statApp.contractQuery.query(address,fields);
        ctx.body = result || {};
    })

    router.get('/contract/registered/name', async (ctx)=>{
        const {name} = ctx.request.query;
        const total = await statApp.contractQuery.count(name);
        ctx.body = {name, registered: total} || {};
    })

    router.get('/tokens/list', async (ctx)=>{
        await new Promise(async r=>{
            const {fields, transferType, currency, orderBy, reverse, skip, limit, addressArray} = ctx.request.query;
            const result = await statApp.tokenQuery.list(addressArray, fields, transferType, currency, orderBy, reverse,
                skip? parseInt(skip): skip, limit ? parseInt(limit): limit);
            ctx.body = result;
            r('ok')
        }).catch(err=>{
            ctx.body = {
                code: 500,
                message: `${err}`
            }
        })
    })
    router.get('/tokens/fiat/list', async (ctx)=>{
        const fiatArray = statApp.config.quoteConvertSymbolArray;
        ctx.body = {code:0, list: fiatArray}
    })
    // token by name
    router.get('/tokens/name', async (ctx)=>{
        await new Promise(async r=>{
            const {name, currency, skip, limit} = ctx.request.query;
            const result = await statApp.tokenQuery.search(name, currency, skip? parseInt(skip): skip,
                limit ? parseInt(limit): limit);
            ctx.body = result;
            r('ok')
        }).catch(err=>{
            ctx.body = {
                code: 500,
                message: `${err}`
            }
        })
    })
    // stat over view
    router.get('/recent-overview', async (ctx)=>{
        const cached = dbCache.get(ctx.request.url)
        if (cached) {
            ctx.body = cached;
            ctx.response.set('cached','true')
            return
        }
        let days = parseInt(ctx.query.days || 1)
        days = Math.max(days, 1)
        days = Math.min(days, 7)
        await Promise.all([
            TxnQuery.txnCountByTime({span:'24h'}),
            // sumRecentCfxTxn(days),
            sumRecentCfxAmount(-days),
            TxnQuery.gasUsedSum(-days),
            countRecentTokenTransfer(-days),
            countRecentTokenTransferAccount(-days),
            countRecentMiner(-days),
        ]).then((arr)=>{
            const [cfxTxn ,cfxAmount ,gasUsed ,tokenTransfer ,tokenAccount , minerCount] = arr
            ctx.body = {
                code: 0, stat: {
                    cfxTxn, cfxAmount, gasUsed, tokenTransfer, tokenAccount, minerCount
                }, days
            }
            dbCache.set(ctx.request.url, ctx.body, cacheTtl)
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
    //
    router.get('/get-cfx-balance-at', async ctx=>{
        const {dt, epoch, accountBase32} = ctx.request.query
        if ( (dt === undefined && epoch === undefined) || accountBase32 === undefined) {
            ctx.body = {code: 500, message: 'miss parameter', query: ctx.request.query}
            return
        }
        const hex = format.hexAddress(accountBase32)
        const hexBean = await Hex40Map.findOne({where:{hex: hex.substr(2)}})
        if (hexBean === null) {
            ctx.body = {code: 501, cfx: "0", message: 'not found'}
            return
        }
        let cfxByEpoch;
        if (epoch) {
            const epochNumber = Number(epoch)
            cfxByEpoch = await CfxBill.findOne({where:{ownerId: hexBean.id, epoch:{[Op.lte]: epochNumber}},
                order:[['epoch','desc'],['seq','desc']], limit: 1, raw: true})
            if (cfxByEpoch) {
                const epoch = await Epoch.findByPk(cfxByEpoch.epoch)
                cfxByEpoch['epoch_dt'] = (epoch||{}).timestamp
            }
        }
        let cfxByDt;
        if (dt) {
            let d = new Date(`${dt} 23:59:59`)
            const nearestEpoch = await Epoch.findOne({where:{timestamp:{[Op.lte]:d}}, order:[['timestamp','desc']], limit: 1})
            const number = nearestEpoch?.epoch || 0
            cfxByDt = await CfxBill.findOne({where:{ownerId: hexBean.id, epoch: {[Op.lte]: number} },
                order:[['epoch','desc'],['seq','desc']], limit: 1, raw: true})
            if (cfxByDt) {
                cfxByDt['dt'] = d
                const epoch = await Epoch.findByPk(cfxByDt.epoch)
                cfxByDt['epoch_dt'] = (epoch||{}).timestamp
            }
        }
        ctx.body = {code: 0, cfxByEpoch, cfxByDt}
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
        const token = await Token.findOne({where: {base32: base32}, attributes:{exclude:['icon']}})
        if (!token) {
            ctx.body = {code: 404, message: `token not found ${base32}`}
            return
        }
        const list = await DailyToken.findAll({limit: Math.min(limit,1000), order:[['day','DESC']],
            where: {hexId: token.hex40id}})
        ctx.body = {code:0, list, token}
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
    // daily total contract count
    router.get('/contract/total/list', async function (ctx) {
        const {skip, limit} = ctx.request.query
        const page = await statApp.contractCreateQuery.listContractCreateDaily(skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);
        let yesterdayTotal = 0;
        // page?.rows.forEach(row => {
        //     row.contractCount = row.contractCount + yesterdayTotal;
        //     yesterdayTotal = row.contractCount;
        // });
        if(page?.rows){
            const len = page.rows.length;
            for(let i = len-1; i >= 0; i--){
                page.rows[i].contractCount = page.rows[i].contractCount + yesterdayTotal;
                yesterdayTotal = page.rows[i].contractCount;
            }
        }

        ctx.body = {code: 0, data: page};
    });

    // deployed contract statistic
    router.get('/contract/deploy/list', async function (ctx) {
        const {skip, limit} = ctx.request.query
        const page = await statApp.contractCreateQuery.listContractCreateDaily(skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);

        let totalContract = 0;
        if(page?.rows){
            const len = page.rows.length;
            for(let i = len-1; i >= 0; i--){
                totalContract = page.rows[i].contractCount + totalContract;
                (page.rows[i])['contractTotalCount'] = totalContract;
            }
        }
        ctx.body = {code: 0, data: page};
    });

    // registered contract statistic
    router.get('/contract/register/list', async function (ctx) {
        const {skip, limit} = ctx.request.query
        const page = await statApp.contractRegisterQuery.listContractRegisterDaily(skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);

        let totalContract = 0;
        if(page?.rows){
            const len = page.rows.length;
            for(let i = len-1; i >= 0; i--){
                totalContract = page.rows[i].contractCount + totalContract;
                (page.rows[i])['contractTotalCount'] = totalContract;
            }
        }
        ctx.body = {code: 0, data: page};
    });

    router.get('/contract/stat/list', async (ctx)=>{
        const {address, skip, limit} = ctx.request.query
        const page = await statApp.contractStatQuery.listStat(address, skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);
        ctx.body = {code: 0, data: page};
    })

    // get creat trace
    router.get('/trace/create', async function (ctx) {
        const {contract} = ctx.request.query
        const createTrace = await statApp.traceCreateQuery.query(contract);
        ctx.body = {code: 0, data: createTrace};
    });
    // get creat trace
    router.post('/recaptcha/siteverify', async function (ctx) {
        const {token, address, type, description, txn_hash} = ctx.request.body;
        const verifyResult = await statApp.siteVerify.verify(token, address, type, description, txn_hash);
        ctx.body = verifyResult;
    });

    // block data stat list
    router.get('/block/stat/list', async function (ctx) {
        const {intervalType, skip, limit} = ctx.request.query
        const page = await statApp.blockDataStatQuery.listStat(intervalType, skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);
        ctx.body = {code: 0, data: page};
    })

    // nft preview
    router.get('/nft/checker/preview', async function (ctx) {
        const { contractAddress, tokenId} = ctx.request.query
        const nftInfo = await statApp.nftPreviewService.getNFTInfo({contractAddress, tokenId: Number(tokenId)});
        ctx.body = {code: 0, data: nftInfo};
    })

    // nft checker, get balances
    router.get('/nft/checker/balance', async function (ctx) {
        const {ownerAddress} = ctx.request.query
        const nftContractAddresses = Object.values(NFTMap).map(nft => nft.address);
        const balanceArray = await statApp.nftCheckerService.getNFTBalances(ownerAddress, nftContractAddresses);
        ctx.body = {code: 0, data: balanceArray};
    })

    // nft checker, get tokens
    router.get('/nft/check/token', async function (ctx) {
        const {ownerAddress, contractAddress, skip, limit} = ctx.request.query
        const tokens = await statApp.nftCheckerService.getNFTTokens(ownerAddress, contractAddress,
            skip? parseInt(skip): skip, limit ? parseInt(limit): limit);
        ctx.body = {code: 0, data: tokens};
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
    app.use(bodyParser())
    let middleware = router.routes();
    app.use(middleware)
    addSwagger(app, router)
    addDevopsRouter(router, statApp)
    console.log('router registered.')
}
