// @ts-ignore
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {format} from "js-conflux-sdk"
import {fmtAddr, StatApp} from "../StatApp";
import * as Koa from 'koa'
import * as Application from 'koa'
import {Context} from 'koa'
import * as Router from 'koa-router'
import {KEY_NFT_FROM_DB, KEY_TX_EPOCH, KV, USE_REMOTE_STAT} from "../model/KV";
import {TxnQuery} from "../service/TxnQuery";
import {koaSwagger} from "koa2-swagger-ui";
import ApiDef from "./ApiDef";
import {addDevopsRouter} from "./DevopsRouter";
import {DailyToken, NftId, NftMint, Token} from "../model/Token";
import {T_DAILY_TOKEN_TXN} from "../model/Erc20Transfer";
import {sumRecentCfxAmount} from "../model/CfxTransfer";
import {Op, QueryTypes} from "sequelize";
import {countRecentTokenTransfer} from "../service/DailyTokenSync";
import {BlockAndMinerSync, countRecentMiner} from "../service/BlockAndMinerSync";
import {Hex40Map} from "../model/HexMap";
import {Epoch} from "../model/Epoch";
import {registerPosRouter} from "./PosRouter";
import {addConfluxConsortiumNFTRouter} from "./ConfluxConsortiumNFTRouter";
import {listNftOfAccountByContract} from "../service/NftService";
import {scientificToBigInt} from "../service/watcher/BalanceService";
import {queryCrossSpaceStat} from "../service/CrossSpaceStat";
import {
    formatBalance,
    formatPercentage,
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent,
} from "../service/common/utils";
import {limitListOnBody} from "../service/pos/PosStat";
import {checkRate, getClientIP, loadRateConfig} from "./RateLimiter";
import {Errors} from "../service/common/LogicError";
import {RateLimiterMemory} from "rate-limiter-flexible";
import {LIMIT_MAX_STAT, paginateCore, paginateCoreStat} from "./ParamChecker";
import * as bodyParser from "koa-bodyparser";
import {ConfigInstance, NoCoreSpace} from "../config/StatConfig";
import {AbiInfo, parseAbiStr, saveAbiInfo} from "../model/ContractInfo";
import {AuthAction, getAuthActionInTx, listAuthAction} from "../model/EIP7702model";
import {getAccountQuery} from "../service/AccountQuery";
import {CONST} from "../service/common/constant";
import axios from "axios";
import {ContractQuery} from "../service/ContractQuery";

const superagent = require('superagent');
const NodeCache = require( "node-cache" );
const cors = require('@koa/cors');
const BigFixed = require('bigfixed');
const moment = require("moment/moment");
const lodash = require('lodash');

const dbCache = new NodeCache()
const cacheTtl = 60 // 1 minutes

export const ROUTER_PREFIX = '/stat'

function addRoute(router: Router<any, {}>, statApp: StatApp) {
    router.get('/server-info', async (ctx: Context) => {
        ctx.body = { serverInfo: `${statApp.config.serverTag} network id ${StatApp.networkId}` }
    })

    router.get('/tokens/nft-token-id-count', async (ctx)=>{
        const groupList = await NftId.sequelize.query(`
            select token.name, token.symbol, t.contractHexId, hex40.hex, token.type, t.cnt 
            from (select count(*) as cnt, contractHexId from nft_id group by contractHexId) t 
            left join token on token.hex40id = t.contractHexId
            left join hex40 on hex40.id=t.contractHexId`,
            {type: QueryTypes.SELECT}
        );

        ctx.body = {
            list: groupList
        }
    })

    router.get('/tokens/daily-token-txn', async (ctx)=>{
        mustBeIntParamIfPresent(ctx.request.query, 'limit');
        const {limit} = paginateCoreStat(ctx.request.query, {limit: LIMIT_MAX_STAT, limitMax: LIMIT_MAX_STAT});

        const sql = `select day, max(updatedAt) as updatedAt, sum(txnCount) as txnCount,
                sum(userCount) as userCount
            from ${T_DAILY_TOKEN_TXN} group by day order by day desc limit ?`
        const list = await statApp.sequelize.query(sql,
            {type: QueryTypes.SELECT, replacements:[limit]}
        )

        ctx.body = {list}
    })

    router.get('/tokens/holder-rank', async (ctx)=>{
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
        mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');
        const {skip, limit} = paginateCore(ctx.request.query, {skipMax: 1000});

        const {address: base32} = ctx.request.query;
        ctx.body = {
            listLimit: 1000,
            ...(await statApp.balanceService.rankHolder(base32, skip, limit, true))
        }
    })

    router.get('/tokens/by-address', async (ctx)=>{
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');

        const {address} = ctx.request.query;
        const result = await statApp.tokenQuery.query({address});
        if(!result?.isRegistered){
            const token = await statApp.tokenQuery.detectToken(address);
            // remove at least transfer restriction on token detail page
            if(token?.reason && !token.reason.includes('token transfer record not exist')){
                throw new Errors.NotTokenError(
                    JSON.stringify({
                        contract: StatApp.isEVM? token.hex : token.base32,
                        message: `contract not detected as a token, ${token.reason}`,
                    })
                );
            }
        }
        if (result?.address) {
            result.address = fmtAddr(result.address, StatApp.networkId);
        }
        ctx.body = result || {};
    })

    router.get('/tokens/detect', async (ctx)=>{
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');

        const {address} = ctx.request.query;
        const result = await statApp.tokenQuery.detectToken(address);

        ctx.body = result || {};
    })

    router.get('/contract/by-address', async (ctx)=>{
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
        const {address} = ctx.request.query;
        const result = await statApp.contractQuery.query(address)
        ctx.body = result || {};
    })
    router.get('/contract/check-abi', async (ctx)=>{
        const base64 = ctx.request.query.base64;
        if(!base64){
            throw new Errors.ParameterError(`param <base64> is absent`);
        }
        let decodedBase64: string;
        try {
            decodedBase64 = Buffer.from(base64, 'base64').toString();
        } catch (e) {
            throw new Errors.ParameterError(`<base64> is invalid: ${e}`);
        }
        try {
            const parsed = parseAbiStr(decodedBase64);
            await saveAbiInfo(parsed, 0, true);
        } catch (e) {
            throw new Errors.ParameterError(`failed to parse abi: ${e}`);
        }
        ctx.body = {result: 0, message: 'ok'};
    });
    router.get('/list-abi-method', async (ctx)=>{
        const id = ctx.request.query.id;
        if (!id || id.length != 10) {
            throw new Errors.ParameterError(`param <id> is invalid`);
        }
        let list = await AbiInfo.findAll({
            where: {hash: id, type: 'function', }, raw: true,
            attributes: ['fullName', 'type', 'hash', 'formatWithArg']
        });
        ContractQuery.listMethodABIBySourcify(id).then();
        ctx.body = {list};
    })
    router.get('/list-abi-event', async (ctx)=>{
        const hash = ctx.request.query.hash;
        if (!hash || hash.length < 66) {
            throw new Errors.ParameterError(`param <hash> is invalid`);
        }
        const arr = [...new Set(hash.split(',').filter(Boolean))];
        const list = await Promise.all(arr.map(h=>AbiInfo.findOne({
            where: {hash: h, type: 'event'}, raw: true,
            attributes: ['fullName', 'type', 'hash', 'formatWithArg']
        })))
        ctx.body = {list};
    })

    router.get('/contract/registered/name', async (ctx)=>{
        const {name} = ctx.request.query;
        const total = await statApp.contractQuery.count({name});
        ctx.body = {name, registered: total} || {};
    })

    router.get('/list-auth-action', async (ctx)=>{
        let {author, skip, limit} = ctx.request.query;
        if (author == 'dev') {
            const latestOne = await AuthAction.findOne({
                order: [['id', 'desc']], raw: true,
            })
            author = latestOne?.author || CONST.ZERO_ADDRESS;
        } else {
            mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'author');
        }
        if (!author) {
            throw new Errors.ParameterError(`param <author> is invalid`);
        }
        mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');
        skip = parseInt(skip || '0');
        limit = parseInt(limit || '10');
        if (skip > 1000) {
            throw new Errors.ParameterError(`param <skip> is invalid: exceeds 1000`);
        }
        if (limit > 100) {
            throw new Errors.ParameterError(`param <limit> is invalid: exceeds 100`);
        }
        const result: any = await listAuthAction({author, skip, limit});
        await getAccountQuery().patchAddressInfo(result.list, 'txSender', 'address');
        const addresses = new Set<string>(result.list.flatMap(item => [item.txSender, item.address]).filter(Boolean));
        result.nameMap = await getAccountQuery().list([...addresses, author]);

        ctx.body = result;
    });
    router.get('/list-auth-action-in-tx', async (ctx)=>{
        let {txHash} = ctx.request.query;
        if (txHash?.length != 66) {
            throw new Errors.ParameterError(`param <txHash> is invalid`);
        }
        const result: any = await getAuthActionInTx(txHash);
        await getAccountQuery().patchAddressInfo(result.list, '', 'address');
        const addresses = new Set<string>(result.list.flatMap(item => [item.address, item.author]).filter(Boolean));
        result.nameMap = await getAccountQuery().list([...addresses]);

        ctx.body = result;
    });

    router.get('/tokens/list', async (ctx)=>{
        mustBeEnumParamIfPresent(ctx.request.query, 'transferType', ['ERC20', 'ERC721', 'ERC1155']);
        mustBeEnumParamIfPresent(ctx.request.query, 'orderBy', ['totalPrice','price', 'securityCredits','transferCount', 'holderCount']);
        mustBeEnumParamIfPresent(ctx.request.query, 'reverse', ['true', 'false']);
        mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');
        const {skip, limit} = paginateCore(ctx.request.query, {skipMax: undefined});

        const {transferType, fields, orderBy, reverse} = ctx.request.query;
        const result = await statApp.tokenQuery.list({transferType, fields, orderBy, reverse, showDestroyed: false,
            skip: skip? parseInt(skip): skip, limit: limit ? parseInt(limit): limit});

        const addresses = result.list.map(item => item.address);
        const ensInfos = await statApp.ensCheckerQuery.nameBatch(addresses);
        result.list.forEach(item => {
            item.ensInfo = ensInfos[format.address(item.address, StatApp.networkId)];
        });

        ctx.body = result;
    })

    router.get('/tokens/list/latest', async (ctx)=>{
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'accountAddress');
        mustBeEnumParamIfPresent(ctx.request.query, 'transferType', ['ERC20', 'ERC721', 'ERC1155']);

        const {accountAddress: owner, transferType: type} = ctx.request.query;
        ctx.body = await statApp.tokenQuery.listRecently({owner, type});
    })

    // token by name
    router.get('/tokens/name', async (ctx)=>{
        const {name} = ctx.request.query;
        const result = await statApp.tokenQuery.list({name, showDestroyed: false});

        if (StatApp.isEVM) {
            result?.list?.forEach(item => item.address = format.hexAddress(item.address));
            result?.contractList?.forEach(item => item.address = format.hexAddress(item.address));
            result?.eoaList?.forEach(item => item.address = format.hexAddress(item.address));
        }

        ctx.body = result;
    })

    // stat overview
    router.get('/recent-overview', async (ctx)=>{
        mustBeIntParamIfPresent(ctx.request.query, 'days');

        const cached = dbCache.get(ctx.request.url)
        if (cached) {
            ctx.body = cached;
            ctx.response.set('cached','true')
            return
        }

        let days = parseInt(ctx.query.days || 1); // default 1
        days = Math.max(days, 1);// use min 1
        days = Math.min(days, 7); // use max 7
        const now = Date.now()
        const timeCosts = {}
        function timeCost(res,key){
            timeCosts[key] = Date.now() - now;
            return res;
        }

        await Promise.all([
            sumRecentCfxAmount(days).then((res)=>timeCost(res,'sumRecentCfxAmount')),
            TxnQuery.gasUsedSum(-days).then((res)=>timeCost(res,'gasUsedSum')),
            countRecentTokenTransfer(-days).then((res)=>timeCost(res,'countRecentTokenTransfer')),
            countRecentMiner(-days).then((res)=>timeCost(res,'countRecentMiner')),
        ]).then((arr)=>{
            console.log(` time cost for overview stat :, ${JSON.stringify(timeCosts)}`)
            const [cfxAmount ,{gasFee:gasUsed, txCount} , {txnCount:tokenTransfer, userCount:tokenAccount} , minerCount] = arr
            ctx.body = {
                stat: {
                    cfxTxn:txCount||0, cfxAmount, gasUsed:gasUsed||0, tokenTransfer: tokenTransfer||0, tokenAccount:tokenAccount||0, minerCount
                }, days
            }
            dbCache.set(ctx.request.url, ctx.body, cacheTtl)
        })
    })

    //top gas used
    router.get('/top-gas-used', async (ctx)=>{
        mustBeEnumParamIfPresent(ctx.request.query, 'span', ['24h', '3d', '7d']);

        const {span} = ctx.request.query;
        ctx.body = statApp.txnQuery.topGasUsedCache[span||'24h'];
    })

    router.get('/top-cfx-holder', async (ctx)=>{
        const useRemote = await KV.getString(USE_REMOTE_STAT, "");
        if (useRemote) {
            const remoteUrl = `${useRemote}${ctx.request.originalUrl}`;
            ctx.set('remoteUrl', remoteUrl)
            ctx.body = await superagent.get(remoteUrl).then(res=>res.body?.result || res.body?.data)
            if (ctx.body) {
                return;
            }
        }
        mustBeEnumParamIfPresent(ctx.request.query, 'type', [
            'rank_address_by_total_cfx',
            'rank_address_by_cfx',
            'rank_address_by_staking',
            'rank_contract_by_number_of_transfers_7d',
            'rank_contract_by_number_of_transfers_3d',
            'rank_contract_by_number_of_transfers_1d',
            'rank_contract_by_number_of_senders_7d',
            'rank_contract_by_number_of_senders_3d',
            'rank_contract_by_number_of_senders_1d',
            'rank_contract_by_number_of_receivers_7d',
            'rank_contract_by_number_of_receivers_3d',
            'rank_contract_by_number_of_receivers_1d',
            'rank_contract_by_number_of_participants_7d',
            'rank_contract_by_number_of_participants_3d',
            'rank_contract_by_number_of_participants_1d',
            ]
        );
        mustBeIntParamIfPresent(ctx.request.query, 'limit');
        const {limit} = paginateCore(ctx.request.query);

        const {type} = ctx.request.query || {type: 'cfxSend', limit: 10};
        ctx.body = await statApp.rankService.top(type, limit, StatApp.networkId)
    })

    router.get('/top-cfx-holder-csv', async (ctx) => {
        mustBeEnumParamIfPresent(ctx.request.query, 'type', [
            'rank_address_by_total_cfx',
            'rank_address_by_cfx',
            'rank_address_by_staking',
            'rank_contract_by_number_of_transfers_7d',
            'rank_contract_by_number_of_transfers_3d',
            'rank_contract_by_number_of_transfers_1d',
            'rank_contract_by_number_of_senders_7d',
            'rank_contract_by_number_of_senders_3d',
            'rank_contract_by_number_of_senders_1d',
            'rank_contract_by_number_of_receivers_7d',
            'rank_contract_by_number_of_receivers_3d',
            'rank_contract_by_number_of_receivers_1d',
            'rank_contract_by_number_of_participants_7d',
            'rank_contract_by_number_of_participants_3d',
            'rank_contract_by_number_of_participants_1d',
        ]);
        mustBeEnumParamIfPresent(ctx.request.query, 'lang', ['cn', 'en']);
        mustBeIntParamIfPresent(ctx.request.query, 'limit');
        const {limit: size} = paginateCore(ctx.request.query, {limitMax: 5000});

        const {type, lang} = ctx.request.query || {type: 'cfxSend', limit: 10, lang: 'cn'};
        const name = `${type}`
        const key = `top-cfx-holder_${type}_${size}`;

        let data = dbCache.get(key);
        if (!data?.list) {
            data = await statApp.rankService.top(type, size, StatApp.networkId);
            if (!data?.list) {
                ctx.body = data?.list;
                return;
            }
            dbCache.set(key, data, 60); // 60s
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
        const nameMap = data.nameMap;
        data.list.forEach(row=>{
            s.push(row.rank); s.push(',') // rank
            s.push(StatApp.isEVM ? row.hex : row.base32address); s.push(',') // base32
            // s.push(row.contractInfo?.name || row.tokenInfo?.name); s.push(',') // name
            const nameInfo = nameMap[fmtAddr(row.hex, StatApp.networkId)];
            s.push(nameInfo?.contract?.name || nameInfo?.token?.name); s.push(',') // name
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

    router.get('/top-token-holder-csv', async (ctx) => {
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
        mustBeEnumParamIfPresent(ctx.request.query, 'lang', ['cn', 'en']);
        mustBeIntParamIfPresent(ctx.request.query, 'limit');

        const {address} = ctx.request.query;
        const {limit} = paginateCore(ctx.request.query, {limitMax: 5000});
        const {lang} = ctx.request.query

        const base32 = format.address(address, StatApp.networkId);
        let token = await Token.findOne({where: {base32: base32}, attributes: {exclude: ['icon']}})
        if (token == null) {
            throw new Errors.ParameterError(`Token ${base32} not exists`);
        }
        token.totalSupply = scientificToBigInt(token.totalSupply) as unknown as number

        const key = `top-token-holder_${limit}_${token.symbol}_${token.hex40id}`;
        let data = dbCache.get(key);
        if (!data?.list) {
            data = await statApp.balanceService.rankHolder(base32, 0, limit, true)
            if (!data?.list) {
                ctx.body = data?.list;
                return;
            }
            dbCache.set(key, data, 60); // 60s
        }

        const date = moment(new Date()).format('YYYY.MM.DD')
        const tokenAddr = StatApp.isEVM ? format.hexAddress(base32) : base32
        const filename=`tokenholders-${token.type}-${token.symbol}-${tokenAddr}-${date}.csv`
        const encodedFilename = encodeURIComponent(filename);
        const contentDisposition = `attachment; filename*=UTF-8''${encodedFilename}`;
        ctx.set('Content-disposition', contentDisposition)
        ctx.set('Content-type', 'text/csv')

        const s = []
        s.push(lang === 'cn' ? '地址,合约,名称,数量,数量,百分比' : 'HolderAddress, HolderAddressName, IsContract, Quantity, Percentage')
        s.push('\n');

        const decimals = token.decimals || 0
        const nameMap = data.nameMap;
        data.list.forEach(row=>{
            const addr = StatApp.isEVM ? format.hexAddress(row?.account?.address) : row?.account?.address
            s.push(addr); s.push(',') // HolderAddress
            // const name =  row?.ensInfo?.name || row?.nameTagInfo?.nameTag || row?.contractInfo?.name || row?.tokenInfo?.name;
            const nameInfo = nameMap[fmtAddr(addr, StatApp.networkId)];
            const name = nameInfo?.ens?.name || nameInfo?.nameTag?.nameTag || nameInfo?.contract?.name || nameInfo?.token?.name;
            s.push(name); s.push(',') // HolderAddressName
            s.push(row?.contractInfo ? "yes" : ""); s.push(',') // IsContract
            const quantity = BigFixed(row?.balance).div(BigFixed(10).pow(decimals))
            s.push(`"${formatBalance(quantity.toString(), 2)}"`); s.push(',') // Quantity
            const percentage = BigFixed(row?.balance).div(BigFixed(token.totalSupply)).mul(BigFixed(100))
            s.push(formatPercentage(percentage.toString(), 3)) // Percentage
            s.push('\n')
        })

        ctx.body = s.join('');
    })

    router.get('/get-cfx-balance-at', async ctx=>{
        if (ctx.request.query.epoch === '') {
            delete ctx.request.query.epoch
        }
        mustBeIntParamIfPresent(ctx.request.query, 'epoch');
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'accountBase32');

        const {dt, epoch, accountBase32} = ctx.request.query
        if (!accountBase32) {
            throw new Errors.ParameterError(`miss parameter, accountBase32=[${accountBase32}]`);
        }
        if (!dt && !epoch) {
            throw new Errors.ParameterError(`miss parameter, dt=[${dt}] OR epoch=[${epoch}]`);
        }

        const hex = format.hexAddress(accountBase32)
        const hexBean = await Hex40Map.findOne({where:{hex: hex.substr(2)}})
        if (hexBean === null) {
            throw new Errors.ParameterError(`${accountBase32} not found`);
        }
        let cfxByEpoch;
        function checkRpcError(e: Error) {
            if (e["code"] === -32016 || e['code'] === -32602) { // out of bound
                if (
                    e.message?.includes('Invalid param')
                    || e.message?.includes('out-of-bound')
                ) {
                    throw new Errors.ParameterError(e.message);
                }
                throw new Errors.RpcBizError(e.message);
            }
            throw e;
        }
        if (epoch) {
            const epochNumber = Number(epoch)
            const balance = await statApp.fullStateCfx.getBalance(accountBase32, epochNumber).catch(checkRpcError)
            const nearestEpoch = await Epoch.findOne({where:{epoch: epochNumber}})
            cfxByEpoch = {epoch, epoch_dt: nearestEpoch?.timestamp || '', balance}
        }
        let cfxByDt;
        if (dt) {
            let d;
            try {
                d = new Date(`${dt} 23:59:59`)
            } catch (e) {
                throw new Error(`invalid parameter, date [${dt}]`)
            }
            const nearestEpoch = await Epoch.findOne({where:{timestamp:{[Op.lte]:d}}, order:[['timestamp','desc']], limit: 1})
            const epochNumber = nearestEpoch?.epoch || 0
            const balance = await statApp.fullStateCfx.getBalance(accountBase32, epochNumber).catch(checkRpcError)
            cfxByDt = {epoch: epochNumber, epoch_dt: nearestEpoch?.timestamp, balance}
        }
        ctx.body = {cfxByEpoch, cfxByDt}
    })

    // miner topN
    router.get('/miner/top-by-type', async (ctx)=>{
        mustBeEnumParamIfPresent(ctx.request.query, 'span', ['3', '7', '24']);
        mustBeEnumParamIfPresent(ctx.request.query, 'rows', ['10']);
        mustBeEnumParamIfPresent(ctx.request.query, 'type', ['d', 'h']);

        const { span, type, rows, useCache = true } = ctx.request.query;
        const originData = await BlockAndMinerSync.topByType(parseInt(span), type, parseInt(rows || 10), useCache);
        const {list,allDifficulty} = originData;
        const timeRange = BlockAndMinerSync.calculateTimeRange(list);
        const seconds = BlockAndMinerSync.calculateHashRate(list, timeRange.beginTime, timeRange.endTime);
        ctx.body = {
            ...originData,
            allDifficulty,
            ...timeRange,
            seconds,
            total: list.length,
        };
    })

    // tx topN
    router.get('/tx/top-by-type', async function (ctx) {
        mustBeEnumParamIfPresent(ctx.request.query, 'span', ['3', '7', '24']);
        mustBeEnumParamIfPresent(ctx.request.query, 'rows', ['10']);
        mustBeEnumParamIfPresent(ctx.request.query, 'type', ['d', 'h']);
        mustBeEnumParamIfPresent(ctx.request.query, 'action', ['cfxSend', 'cfxReceived', 'txnSend', 'txnReceived']);

        const { span, type, rows, action } = ctx.request.query;
        const top = await statApp.txnSync.txTopBy(span, type, parseInt(rows), action, StatApp.networkId);
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

    // daily token stat
    router.get('/daily-token-stat', async function (ctx) {
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'base32', 'address');
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
        mustBeIntParamIfPresent(ctx.request.query, 'limit');
        const {limit} = paginateCoreStat(ctx.request.query, {skipMax: undefined});

        const addr = ctx.request.query.base32 || ctx.request.query.address || '';
        const base32 = format.address(addr, StatApp.networkId, false);
        const token = await Token.findOne({
            attributes: ['name', 'symbol', 'decimals', 'granularity', 'totalSupply', 'type', 'hex40id'],
            where: {base32: base32}
        });
        if (!token) {
            throw new Errors.ParameterError(`token not found ${addr}`);
        }
        const list = await DailyToken.findAll({limit, order:[['day','DESC']], where: {hexId: token.hex40id}})
        ctx.body = {list, token, base32, hex: format.hexAddress(base32), addressParam: addr}
    })

    router.get('/cross-space-cfx', async (ctx)=>{
        mustBeIntParamIfPresent(ctx.request.query, 'minTimestamp', 'maxTimestamp');
        await queryCrossSpaceStat('DailyCfxToEVM', 'DailyCfxFromEVM',
            'DailyCfxCountToEVM', 'DailyCfxCountFromEVM',
            ctx)
        limitListOnBody(ctx)
    })

    router.get('/contract/stat/list', async (ctx)=>{
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
        mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');
        const {skip, limit} = paginateCoreStat(ctx.request.query, {limit: LIMIT_MAX_STAT, limitMax: LIMIT_MAX_STAT, skipMax: undefined});

        const {address} = ctx.request.query
        ctx.body = await statApp.statsQuery.listDailyContractTransferStat({address, skip, limit, sort: 'desc'});
    })

    router.get('/trace/create', async function (ctx) {
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contract');

        const {contract} = ctx.request.query
        const createTrace = await statApp.traceCreateQuery.query(contract);
        ctx.body = createTrace;
    });

    router.get('/nft/checker/preview', async function (ctx) {
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractAddress');
        mustBeIntParamIfPresent(ctx.request.query, 'tokenId');

        const { contractAddress, tokenId} = ctx.request.query
        ctx.body = await statApp.nftPreviewService.getNFTInfoForScan({contractAddress, tokenId: BigInt(tokenId)});
    })

    router.get('/nft/checker/detail', async function (ctx) {
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractAddress');
        mustBeIntParamIfPresent(ctx.request.query, 'tokenId');

        const {contractAddress, tokenId} = ctx.request.query
        const nftDetail = await statApp.nftPreviewService.getNFTDetail({contractAddress, tokenId: BigInt(tokenId)});
        ctx.set('external-ms', (nftDetail?.externalMs || 0) as any)
        ctx.body = nftDetail;
    })

    const refreshRateLimiter = new RateLimiterMemory({ points: 1, duration: 600 });
    router.get('/nft/checker/refresh', async function (ctx) {
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractAddress');
        mustBeIntParamIfPresent(ctx.request.query, 'tokenId');

        const { contractAddress, tokenId} = ctx.request.query
        const consumerKey = `${getClientIP(ctx)}-${contractAddress}-${tokenId}`
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

    router.get('/nft/list1155inventory', async function (ctx) {
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractAddr', 'userAddr');
        mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit', 'tokenId');
        const {skip, limit} = paginateCore(ctx.request.query, {skipMax: undefined});

        const {contractAddr, userAddr, tokenId} = ctx.request.query;
        const result = await statApp.nftCheckerService.listNftTokensForOpenApiPro({
            owner: userAddr, contract: contractAddr, tokenId: tokenId?.toString(), skip, limit});

        const addresses = result.list.map(item => item.owner);
        const map = await statApp.accountQuery.list(addresses, {withContractInfo: true});
        result.list.forEach(row => {
            lodash.defaults(row, {
                ownerTokenInfo: map[row.owner]?.token,
                ownerContractInfo: map[row.owner]?.contract
            });
        });

        result["listLimit"] = 10_000;
        ctx.body = result;
    });

    router.get('/nft/active-token-ids', async function (ctx) {
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractAddress');
        mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');
        const {skip, limit} = paginateCore(ctx.request.query, {skipMax: undefined});

        const {contractAddress} = ctx.request.query
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
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'ownerAddress', 'contractAddress');
        mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');
        const {skip, limit} = paginateCore(ctx.request.query, {skipMax: undefined});

        const {ownerAddress, contractAddress} = ctx.request.query
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
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'ownerAddress', 'contractAddress');
        mustBeEnumParamIfPresent(ctx.request.query, 'withDetail', ['true', 'false']);
        mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');
        const {skip, limit} = paginateCore(ctx.request.query, {skipMax: undefined});

        const {ownerAddress, contractAddress, withDetail} = ctx.request.query
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

    router.get('/ens/nameRegistrations', async (ctx)=>{
        mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');
        const {skip, limit} = paginateCore(ctx.request.query, {skipMax: undefined});

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
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');

        const {address} = ctx.query
        const data = await statApp.ensCheckerQuery.lookupAddress(address);
        ctx.body = data
    })

    router.get('/ens/ownedNames', async (ctx)=>{
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
        const {address} = ctx.query

        console.log(`ownedNames address ${address}`)
        const resp = await statApp.ensCheckerQuery.getOwnedNames(address);
        const data = resp?.account?.registrations?.map(item => ({name: `${item.labelName}`, expiryDate: item.expiryDate}));
        ctx.body = data || []
    })

    router.get('/ens/resolvedNames', async (ctx)=>{
        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');

        const {address} = ctx.query
        const resp = await statApp.ensCheckerQuery.getResolvedNames(address);
        const data = resp?.account?.domains?.map(item => item.name);
        ctx.body = data || []
    })

    router.get('/transfer/tps', async function (ctx) {
        const tps = await statApp.statOnRealtime.getTokenTransferPerSecond();
        ctx.body = {...tps};
    });

    router.get('/gasused/tps', async function (ctx) {
        const tps = await statApp.statOnRealtime.getGasUsedPerSecond();
        ctx.body = {...tps};
    });

    router.get('/gasprice/tracker', async function (ctx) {
        const tps = await statApp.statOnRealtime.getGasPriceTracker();
        ctx.body = {...tps};
    });

    router.get('/transaction/pending', async function (ctx) {
        const {accountAddress} = ctx.request.query
        if (statApp.config.pendingTxNotAvailable || !accountAddress) {
            ctx.body = []
            return;
        }

        mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'accountAddress');

        let result;
        if(StatApp.isEVM) {
            if (NoCoreSpace) {
                result = await statApp.fullBlockQuery.listPendingTxEvmGeneral({accountAddress});
            } else{
                result = await statApp.fullBlockQuery.listPendingTxEvm({accountAddress});
            }
        } else {
            result = await statApp.fullBlockQuery.listPendingTx({accountAddress});
        }
        ctx.body = result;
    });

    router.post('/rpc/debugTraceCall', async function (ctx) {
        const {params} = ctx.request.body as any;
        ctx.body = await statApp.accountQuery.debugTraceCall(params);
    });
}

// swagger stat doesn't support multiple instances,
// use this hook to bypass.
let swStatFn = function(ctx, next) {
    console.log(`${__filename} call to stub`)
    return next()
}

export function setSwStatFn(fn) {
    swStatFn = fn
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
    console.log(`do not register swagger-stat on stat-router.`)
    app.use((ctx,next)=>swStatFn(ctx, next))
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
                console.log(`url ${ctx.originalUrl} \nunhandled error caught by router:`, e);
                e = new Errors.BizError(e.message);
            } else if (e.code === 'INVALID_ARGUMENT'
                || (e.code === 5200 && e.message?.includes("(Invalid input|args"))) {
                e = new Errors.ParameterError(e.message || `${e}`);
            }
            if (e.status === undefined || e.status === null) {
                e['url'] = ctx.originalUrl;
                console.log(`url ${ctx.originalUrl} \nunknown error caught by router:`, e);
                safeAddErrorLog('stat-router', `stat-500-${e.message}`, e).then()
                e.status = 500;
                e.message = "unknown error"
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
