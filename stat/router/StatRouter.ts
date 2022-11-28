// @ts-ignore
import {format} from "js-conflux-sdk"
import {StatApp} from "../StatApp";
import * as Koa from 'koa'
import {Context} from 'koa'
import * as Router from 'koa-router'
import bodyParser = require("koa-bodyparser");
import {KEY_NFT_FROM_DB, KEY_TX_EPOCH, KV} from "../model/KV";
import {TxnQuery} from "../service/TxnQuery";
import {koaSwagger} from "koa2-swagger-ui";
import ApiDef from "./ApiDef";
import {addDevopsRouter} from "./DevopsRouter";
import {pickNumber} from "../model/Utils";
import {DailyToken, NftId, NftMint, Token} from "../model/Token";
import {T_DAILY_TOKEN_TXN} from "../model/Erc20Transfer";
import {DailyCfxTxn, sumRecentCfxAmount} from "../model/CfxTransfer";
import Application = require("koa");
import {QueryTypes,Op} from "sequelize";
import {AddressStat, DailyActiveAddress} from "../model/StatAddress";
import {countRecentTokenTransfer} from "../service/DailyTokenSync";
import {BlockAndMinerSync, countRecentMiner} from "../service/BlockAndMinerSync";
import {Hex40Map} from "../model/HexMap";
import {Epoch} from "../model/Epoch";
import {CfxBill} from "../service/watcher/DummyNode";
import {registerPosRouter} from "./PosRouter";
import {addConfluxConsortiumNFTRouter} from "./ConfluxConsortiumNFTRouter";
import {listNftOfAccountByContract, list1155inventory} from "../service/NftService";
import {BalanceService} from "../service/watcher/BalanceService";
import {queryCrossSpaceStat} from "../service/CrossSpaceStat";
import {queryEnsOfName} from "../service/ens/ENS";
import {ENS, matchNamesOnChain} from "../service/ens/EnsService";
import {getPagination, skipLimit} from "../service/common/utils";
import {limitListOnBody} from "../service/pos/PosStat";
import {checkRate, loadRateConfig} from "./RateLimiter";
import {Errors} from "../service/common/LogicError";
import {RateLimiterMemory} from "rate-limiter-flexible";

const e2k = require('express-to-koa');
const swStats = require('swagger-stats');
const NodeCache = require( "node-cache" );
const cors = require('@koa/cors');
const requestIp = require('request-ip');

const dbCache = new NodeCache()
const cacheTtl = 60 * 10 // 10 minutes

export const ROUTER_PREFIX = '/stat'

function addRoute(router: Router<any, {}>, statApp: StatApp) {
    router.get('/server-info', async (ctx: Context) => {
        ctx.body = { serverInfo: `${statApp.config.serverTag} network id ${StatApp.networkId}` }
    })
    router.get('/contract/all', async (ctx)=>{
        ctx.body = {
            list: [...statApp.contractService.map.values()]
        }
    })
    router.get('/account-token-balance', async(ctx) => {
        // not used by scan.
        const {base32} = ctx.request.query
        const list = await BalanceService.listAccountBalance(base32)
        ctx.body = {list}
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
        ctx.body = {list}
    })
    router.get('/tokens/holder-rank', async (ctx)=>{
        const base32 = ctx.request.query.address
        const {skip, limit} = skipLimit(ctx.request.query)
        if (skip > 1000) {
            throw new Errors.ParameterError(`Parameter <skip> exceeds 1000`)
        }
        ctx.body = {
            listLimit: 1000,
            ...(await statApp.balanceService.rankHolder(base32, skip, limit))
        }
    })
    router.get('/tokens/by-address', async (ctx)=>{
        const {address} = ctx.request.query;
        const result = await statApp.tokenQuery.query({address});
        if(!result?.isRegistered){
            const token = await statApp.tokenQuery.detectToken(address);
            if(token?.reason){
                throw new Errors.NotTokenError(
                    JSON.stringify({
                        contract: StatApp.isEVM? token.hex : token.base32,
                        message: `contract not detected as a token, ${token.reason}`,
                    })
                );
            }
        }
        ctx.body = result || {};
    })
    router.get('/tokens/detect', async (ctx)=>{
        const {address} = ctx.request.query;
        const result = await statApp.tokenQuery.detectToken(address);
        ctx.body = result || {};
    })

    router.get('/contract/by-address', async (ctx)=>{
        const {fields, address} = ctx.request.query;
        console.log(`fields---------${JSON.stringify(fields)},address---------------${address}`)
        const result = await statApp.contractQuery.query({address,fields});
        ctx.body = result || {};
    })

    router.get('/contract/registered/name', async (ctx)=>{
        const {name} = ctx.request.query;
        const total = await statApp.contractQuery.count({name});
        ctx.body = {name, registered: total} || {};
    })

    router.get('/tokens/list', async (ctx)=>{
        const {transferType, fields, orderBy, reverse, skip, limit} = ctx.request.query;
        const result = await statApp.tokenQuery.list({transferType, fields, orderBy, reverse, showDestroyed: false,
            skip: skip? parseInt(skip): skip, limit: limit ? parseInt(limit): limit});

        const addressArray = result.list.map(item => item.address);
        const ensBasic = await statApp.ensCheckerQuery.nameBatch(addressArray );
        result.list.forEach(item => {
            item.ensInfo = ensBasic[item.address];
        });

        ctx.body = result;
    })
    router.get('/tokens/list/latest', async (ctx)=>{
        const {accountAddress, transferType} = ctx.request.query;
        const result = await statApp.tokenQuery.listLatest({accountAddress, transferType});
        ctx.body = result;
    })
    router.get('/tokens/fiat/list', async (ctx)=>{
        const fiatArray = statApp.config.quoteConvertSymbolArray;
        ctx.body = { list: fiatArray }
    })
    // token by name
    router.get('/tokens/name', async (ctx)=>{
        const {name} = ctx.request.query;
        const result = await statApp.tokenQuery.list({name, showDestroyed: false});

        if (StatApp.isEVM) {
            result?.list?.forEach(item => item.address = format.hexAddress(item.address));
            result?.contractList?.forEach(item => item.address = format.hexAddress(item.address));
        }

        ctx.body = result;
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
        const now = Date.now()
        const timeCosts = {}
        function timeCost(res,key){
            timeCosts[key] = Date.now() - now;
            return res;
        }
        await Promise.all([
            // sumRecentCfxTxn(days),
            sumRecentCfxAmount(days).then((res)=>timeCost(res,'sumRecentCfxAmount')),
            TxnQuery.gasUsedSum(-days).then((res)=>timeCost(res,'gasUsedSum')),
            countRecentTokenTransfer(-days).then((res)=>timeCost(res,'countRecentTokenTransfer')),
            // countRecentTokenTransferAccount(-days),
            countRecentMiner(-days).then((res)=>timeCost(res,'countRecentMiner')),
        ]).then((arr)=>{
            console.log(` time cost for overview stat :, ${JSON.stringify(timeCosts)}`)
            const [cfxAmount ,{gasFee:gasUsed, txCount} , {txnCount:tokenTransfer , userCount:tokenAccount} , minerCount] = arr
            ctx.body = {
                stat: {
                    cfxTxn:txCount, cfxAmount, gasUsed, tokenTransfer, tokenAccount, minerCount
                }, days
            }
            dbCache.set(ctx.request.url, ctx.body, cacheTtl)
        })
    })
    function updateTopGasUsed() {
        return {
            '7d': TxnQuery.topByGasUsed({span: '7d'}),
            '3d': TxnQuery.topByGasUsed({span: '3d'}),
            '24h': TxnQuery.topByGasUsed({span: '24h'}),
        };
    }
    let topGasUsedCache = updateTopGasUsed();
    setInterval(()=>{topGasUsedCache = updateTopGasUsed()}, 3600_000)
    //top gas used
    router.get('/top-gas-used', async (ctx)=>{
        const {span} = ctx.request.query;
        ctx.body = await topGasUsedCache[span||'24h'];
    })
    //
    router.get('/top-cfx-holder', async (ctx)=>{
        const rank = statApp.rankService
        const {type, limit} = ctx.request.query || {type: 'cfxSend', limit: 10};
        ctx.body = await rank.top(type, parseInt(limit), StatApp.networkId)
    })
    //
    router.get('/top-cfx-holder-csv', async (ctx) => {
        const rank = statApp.rankService
        const {type, limit, lang} = ctx.request.query || {type: 'cfxSend', limit: 10, lang: 'cn'};
        const size = pickNumber(limit, 10);
        if (size > 5000) {
            throw new Errors.ParameterError(`max record exceeds 5000.`);
        }
        const name = `${type}`

        const key = `top-cfx-holder_${type}_${size}`;
        let list = dbCache.get(key);
        if (list) {
            // console.log(`from cache.`, list)
        } else {
            const data = await rank.top(type, size, StatApp.networkId);
            list = data.list;
            // console.log(` from db.`, data)
            if (!list) {
                ctx.body = data;
                return;
            }
            dbCache.set(key, list, 60); // 60s
        }
        ctx.set('Content-disposition', 'attachment; filename=' + name + '.csv')
        ctx.set('Content-type', 'text/csv')
        const s = []
        if (StatApp.isEVM) {
            s.push(lang === 'cn' ? '序号,地址,地址名称,余额百分比,交易数'
                : 'rank,address,address name,balance,percent,transactionCount')
        } else {
            s.push(lang === 'cn' ? '序号,地址,地址名称,余额,质押,总和,百分比,交易数'
                : 'rank,address,address name,balance,staking,total,percent,transactionCount')
        }
        s.push('\n');
        list.forEach(row=>{
            s.push(row.rank); s.push(',') // rank
            s.push(StatApp.isEVM ? row.hex : row.base32address); s.push(',') // base32
            s.push(row.name); s.push(',') // name
            s.push(row.value2); s.push(',') // balance
            if (!StatApp.isEVM) {
                s.push(row.value3);
                s.push(',') // staking
                s.push(row.value4);
                s.push(',') // total
            }
            s.push(row.percent); s.push(',') // percent
            s.push(row.valueN); // s.push(',')     // tx count

            s.push('\n')
        })

        ctx.body = s.join('');
    })
    //
    router.get('/get-cfx-balance-at', async ctx=>{
        const {dt, epoch, accountBase32} = ctx.request.query
        if ( (dt === undefined && epoch === undefined) || accountBase32 === undefined) {
            throw new Errors.ParameterError(`miss parameter, query: ${ctx.request.query}`);
        }
        const hex = format.hexAddress(accountBase32)
        const hexBean = await Hex40Map.findOne({where:{hex: hex.substr(2)}})
        if (hexBean === null) {
            throw new Errors.ParameterError(`${accountBase32} not found`);
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
        ctx.body = {cfxByEpoch, cfxByDt}
    })
    // miner topN
    router.get('/miner/top-by-type', async (ctx)=>{
        const { span, type, rows } = ctx.request.query;
        const {list,allDifficulty} = await BlockAndMinerSync.topByType(parseInt(span), type, parseInt(rows || 10));
        const timeRange = BlockAndMinerSync.calculateTimeRange(list);
        const seconds = BlockAndMinerSync.calculateHashRate(list, timeRange.beginTime, timeRange.endTime);
        ctx.body = {
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
        ctx.body = {
            txEpoch: tx,
            chainEpoch: await statApp.cfx.getEpochNumber()
        };
    });

    // daily address creation.
    router.get('/daily-address-creation', async function (ctx) {
        let limit = parseInt(ctx.request.query.limit || 1000);
        const list = await AddressStat.findAll({limit: Math.min(limit,1000), order:[['day','DESC']]})
        ctx.body = {list}
    })
    // daily active address.
    router.get('/daily-active-address', async function (ctx) {
        let limit = parseInt(ctx.request.query.limit || 1000);
        const list = await DailyActiveAddress.findAll({limit: Math.min(limit,1000), order:[['day','DESC']]})
        ctx.body = {list}
    })
    // daily token stat
    router.get('/daily-token-stat', async function (ctx) {
        let limit = parseInt(ctx.request.query.limit || 1000);
        const base32 = ctx.request.query.base32 || ''
        const token = await Token.findOne({
            attributes: ['name', 'symbol', 'decimals', 'granularity', 'totalSupply', 'type', 'hex40id'],
            where: {base32: base32}
        });
        if (!token) {
            throw new Errors.ParameterError(`token not found ${base32}`);
        }
        const list = await DailyToken.findAll({limit: Math.min(limit,1000), order:[['day','DESC']],
            where: {hexId: token.hex40id}})
        ctx.body = {list, token}
    })
    // daily cfx transfer count
    router.get('/daily-cfx-txn', async function (ctx) {
        let limit = parseInt(ctx.request.query.limit || 1000);
        const list = await DailyCfxTxn.findAll({limit: Math.min(limit,1000), order:[['day','DESC']]})
        ctx.body = {list}
    })
    // daily tx count
    router.get('/txn/daily/list', async function (ctx) {
        const {skip, limit} = ctx.request.query
        const page = await statApp.dailyTxnQuery.listTxnDaily(skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);
        ctx.body = page;
    });
    // daily cfx holder count
    router.get('/cfx_holder/daily/list', async function (ctx) {
        const {skip, limit} = ctx.request.query
        const page = await statApp.cfxHolderQuery.listCfxHolderDaily(skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);
        ctx.body = page;
    });
    // daily contract count
    router.get('/contract/daily/list', async function (ctx) {
        const {skip, limit} = ctx.request.query
        const page = await statApp.contractCreateQuery.listContractCreateDaily(skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);
        ctx.body = page;
    });
    // daily total contract count
    router.get('/contract/total/list', async function (ctx) {
        const {skip, limit} = ctx.request.query
        const page = await statApp.contractCreateQuery.listContractCreateDaily(skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);
        let yesterdayTotal = 0;
        if(page?.rows){
            const len = page.rows.length;
            for(let i = len-1; i >= 0; i--){
                page.rows[i].contractCount = page.rows[i].contractCount + yesterdayTotal;
                yesterdayTotal = page.rows[i].contractCount;
            }
        }

        ctx.body = page;
    });
    router.get('/cross-space-cfx', async (ctx)=>{
        await queryCrossSpaceStat('DailyCfxToEVM', 'DailyCfxFromEVM',
            'DailyCfxCountToEVM', 'DailyCfxCountFromEVM',
            ctx)
        limitListOnBody(ctx)
    })
    // deployed contract statistic
    router.get('/contract/deploy/list', async function (ctx) {
        const {skip, limit} = ctx.request.query
        const page = await statApp.contractCreateQuery.listContractCreateDaily(skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);

        ctx.body = page;
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
        ctx.body = page;
    });

    router.get('/contract/stat/list', async (ctx)=>{
        const {address, skip, limit} = ctx.request.query
        const page = await statApp.contractStatQuery.listStat(address, skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);
        ctx.body = page;
    })

    // get creat trace
    router.get('/trace/create', async function (ctx) {
        const {contract} = ctx.request.query
        const createTrace = await statApp.traceCreateQuery.query(contract);
        ctx.body = createTrace;
    });
    // get creat trace
    router.post('/recaptcha/siteverify', async function (ctx) {
        //@ts-ignore
        const {token, address, type, description, txn_hash} = ctx.request.body;
        const verifyResult = await statApp.siteVerify.verify(token, address, type, description, txn_hash);
        ctx.body = verifyResult;
    });

    // block data stat list
    router.get('/block/stat/list', async function (ctx) {
        const {intervalType, skip, limit} = ctx.request.query
        const page = await statApp.blockDataStatQuery.listStat(intervalType, skip? parseInt(skip): skip,
            limit ? parseInt(limit): limit);
        ctx.body = page;
    })

    // nft preview
    router.get('/nft/checker/preview', async function (ctx) {
        const { contractAddress, tokenId} = ctx.request.query
        ctx.body = await statApp.nftPreviewService.getNFTInfo({contractAddress, tokenId: BigInt(tokenId)});
    })

    // nft detail
    router.get('/nft/checker/detail', async function (ctx) {
        const { contractAddress, tokenId} = ctx.request.query
        const nftDetail = await statApp.nftPreviewService.getNFTDetail({contractAddress, tokenId: BigInt(tokenId)});
        ctx.set('external-ms', (nftDetail?.externalMs || 0) as any)
        ctx.body = nftDetail;
    })

    // nft refresh
    const refreshRateLimiter = new RateLimiterMemory({ points: 1, duration: 600 });
    router.get('/nft/checker/refresh', async function (ctx) {
        const { contractAddress, tokenId} = ctx.request.query

        const consumerKey = `${requestIp.getClientIp(ctx.request)}-${contractAddress}-${tokenId}`
        try {
            await refreshRateLimiter.consume(consumerKey, 1);
        } catch (e) {
            console.log(`refresh nft hit rate limit, key:${consumerKey}`, e);
            ctx.body = {code: 429, message:`Too many requests, refresh nft key:${consumerKey}.`};
            return;
        }

        const nftDetail = await statApp.nftPreviewService.getNFTDetail({contractAddress, tokenId: BigInt(tokenId), forceFlush: true});
        ctx.set('external-ms', (nftDetail?.externalMs || 0) as any)
        ctx.body = nftDetail;
    })

    // nft checker, get balances
    router.get('/nft/checker/balance', async function (ctx) {
        const {ownerAddress} = ctx.request.query
        // const balanceArray = await statApp.nftCheckerService.getNFTBalances({ownerAddress});
        // const balanceArray = await getRegisterNftBalances(ownerAddress);
        const resp = await statApp.nftCheckerService.getNftBalancesForOpenApi({owner: ownerAddress, limit: 1000});
        ctx.body = resp.list.map(item => ({
            address: item.contract,
            balance: item.balance,
            name: {zh: item.name, en: item.name},
            type: item.name,
        }));
    })

    /*async function list1155assets(ctx) {
        const {contractAddr, userAddr, tokenId} = ctx.request.query;
        const maxSkip = !contractAddr && !userAddr ? 10_000 : Number.MAX_VALUE;
        const {skip: offset, limit} = getPagination(ctx.request.query, {maxSkip, maxLimit: 100});

        const result = await list1155inventory({contractAddr, userAddr, tokenId, offset, limit});
        result["listLimit"] = 10_000;

        const base32arr = patchBase32prop(result.list, 'owner', 'ownerBase32', StatApp.isEVM, StatApp.networkId);
        const accountBasic = await statApp.accountQuery.listPatchInfo(base32arr);
        mapExtInfo(result.list, accountBasic.map, 'ownerBase32', 'ownerTokenInfo', 'ownerContractInfo');
        result.list.forEach(row=>delete row["ownerBase32"]);

        ctx.body = result;
    }*/

    async function list1155assets(ctx) {
        const {contractAddr, userAddr, tokenId} = ctx.request.query;
        const {skip, limit} = getPagination(ctx.request.query, {maxSkip: Number.MAX_VALUE, maxLimit: 100});

        const result = await statApp.nftCheckerService.getNftTokensForOpenApi({
            owner: userAddr,
            contract: contractAddr,
            tokenId,
            withUnique: true,
            skip, limit
        });

        const addressArray = result.list.map(item => item.owner);
        const {map} = await statApp.contractQuery.listBasic({addressArray});
        result?.list?.forEach(row => {
            row.ownerTokenInfo = map[row.owner]?.token || {};
            row.ownerContractInfo = map[row.owner]?.contract || {};
            if(StatApp.isEVM) {
                row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;
                row.owner = row.owner ? format.hexAddress(row.owner) : row.owner;
            }
        });

        result["listLimit"] = 10_000;
        ctx.body = result;
    }

    router.get('/nft/list1155assets', list1155assets);

    router.get('/nft/list1155inventory', list1155assets);

    router.get('/nft/active-token-ids', async function (ctx) {
        const {contractAddress, skip = 0, limit = 10} = ctx.request.query
        const hex = format.hexAddress(contractAddress)
        const hexBean = await Hex40Map.findOne({where:{hex: hex.substr(2)}})
        if (hexBean === null) {
            throw new Errors.ParameterError(`contractAddress:${contractAddress} not found.`);
        }
        const page = await NftMint.findAndCountAll({
            where: {contractId: hexBean.id},
            order: [['updatedAt', 'desc']],
            offset: parseInt(skip || 0),
            limit: Math.min(parseInt(limit || 0), 100),
            raw: true,
        })
        ctx.body = {page, hexBean, hex}
    })

    async function nftCountAndIds (ctx) {
        const {ownerAddress, contractAddress, skip, limit} = ctx.request.query
        // const tokens = await statApp.nftCheckerService.getNFTTokens({ownerAddress, contractAddress,
        //     offset: skip? parseInt(skip): skip, limit: limit ? parseInt(limit): limit});
        const tokenArray = await listNftOfAccountByContract(ownerAddress, contractAddress,
            skip? parseInt(skip): 0, limit ? parseInt(limit): 10);
        const tokenIdArray = [];
        tokenArray.list.forEach(item => tokenIdArray.push(item.tokenId));
        const tokens = [];
        tokens.push(`${tokenIdArray.length}`);
        tokens.push(tokenIdArray);
        ctx.body = {total: tokens.length, list: tokens};
    }
    // nft checker, get tokens
    router.get('/nft/checker/token', nftCountAndIds )

    router.get('/nft/account/token-by-contract', async function(ctx) {
        const {ownerAddress, contractAddress, skip, limit, withDetail} = ctx.request.query
        const useDB = await KV.getString(KEY_NFT_FROM_DB, '')
        // console.log(`use db ${useDB}`)
        if (useDB) {
            const {count, list} = await listNftOfAccountByContract(ownerAddress, contractAddress,
                parseInt(skip || 0), Math.min(100, parseInt(limit || 10)))
            if (withDetail) {
                // output updatedAt for each nft.
                ctx.body = {total: count, list}
            } else {
                // only contains token id.
                ctx.body = {total: count, list: list.map(t => t.tokenId)}
            }
        } else {
            await nftCountAndIds(ctx)
        }
    });
    /*router.get('/ens-query-by-name', async (ctx)=>{
        const {name} = ctx.query
        const info = await queryEnsOfName(name)
        ctx.body = info
    })
    router.get('/ens-query-by-addr', async (ctx)=>{
        const {addr} = ctx.query
        const {rows:list, count} = await ENS.findAndCountAll({where: {addr}, limit: 100, order:[['updatedAt','desc']]})
        ctx.body = {list, total: count, addr}
    })
    router.get('/ens-query-on-chain', async (ctx)=>{
        const {addr} = ctx.query
        const map = await matchNamesOnChain(addr.split(','))
        ctx.body = map;
    })*/
    router.get('/ens/nameRegistrations', async (ctx)=>{
        const {skip, limit} = ctx.query
        const data = await statApp.ensCheckerQuery.getNameRegistrations(
            skip ? parseInt(skip) : undefined,
            limit ? parseInt(limit) : undefined,
        );
        ctx.body = data
    })
    router.get('/ens/resolveName', async (ctx)=>{
        const {name} = ctx.query
        const data = await statApp.ensCheckerQuery.resolveName(name);
        ctx.body = data
    })
    router.get('/ens/lookupAddress', async (ctx)=>{
        const {address} = ctx.query
        const data = await statApp.ensCheckerQuery.lookupAddress(address);
        ctx.body = data
    })
    router.get('/ens/ownedNames', async (ctx)=>{
        const {address} = ctx.query
        console.log(`ownedNames address ${address}`)
        const resp = await statApp.ensCheckerQuery.getOwnedNames(address);
        const data = resp?.account?.registrations?.map(item => ({name: `${item.labelName}`, expiryDate: item.expiryDate}));
        ctx.body = data || []
    })
    router.get('/ens/resolvedNames', async (ctx)=>{
        const {address} = ctx.query
        const resp = await statApp.ensCheckerQuery.getResolvedNames(address);
        const data = resp?.account?.domains?.map(item => item.name);
        ctx.body = data || []
    })
    router.get('/transfer/tps', async function (ctx) {
        const tps = await statApp.transferTpsService.getTps();
        ctx.body = {...tps};
    });
    router.get('/transaction/pending', async function (ctx) {
        const {accountAddress} = ctx.request.query
        const result = await statApp.fullBlockQuery.listPendingTx({accountAddress});
        ctx.body = result;
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
    // metrics
    const pathArr = router.stack.map((layer) => {
        return layer.path.split('/').map((sec) => {
            return sec.startsWith(':') ? `{${sec.substr(1)}}` : sec;
        }).join('/');
    });
    const pathDef = {};
    pathArr.forEach((p) => {
        pathDef[p] = { get: {} };
    });
    // @ts-ignore
    ApiDef.paths = pathDef;
    app.use(e2k(swStats.getMiddleware({
        swaggerSpec: ApiDef,
        uriPath: '/stat/api-stat', // ui at /stat/api-stat/
        hostname: 'stat-api', // Prevent exposure of server ip
        // basePath: '/', // api definition has a prefix.
    })));
    // router.use((ctx,next)=>{
    // ctx.set("script-src 'self'", 'sha256-bLIba9y02h2X9/32+3oS/4EmGe/+1HjpiNUBsaTTIGY=')
    // })
}

export function register(app:Koa, statApp: StatApp) {
    const router = new Router({ prefix: '/stat' })
    router.use(async (ctx, next)=>{
        try {
            await next();
            if(ctx.type === 'text/csv') return;
            ctx.body = StatApp.isEVM ? { status: '1', message: '', result: ctx.body } :
                { code: 0, message: '', data: ctx.body };
        } catch (e) {
            if(e.code === undefined){
                e = new Errors.BizError(e.message);
            }
            ctx.status = e.status;
            ctx.body = StatApp.isEVM ? { status: `${e.code}`, message: e.message, result: e.partialData } :
                { code: e.code, message: e.message, data: e.partialData };
        }
    })
    app.proxy = true
    loadRateConfig().then()
    router.use(checkRate)
    addRoute(router, statApp);
    registerPosRouter(router, statApp)

    const trusted = [
        "'self'",
    ];

    app.use(cors())
    app.use(bodyParser())
    addSwagger(app, router)
    let middleware = router.routes();
    app.use(middleware)
    addDevopsRouter(router, statApp)
    addConfluxConsortiumNFTRouter(router, statApp)
    console.log('router registered.')
}
