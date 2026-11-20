import {Token} from "../model/Token";
import {TokenQuoteTrack} from "../model/TokenQuoteTrack";
import {TokenQuoteHistory} from "../model/TokenQuoteHistory";
import {Op} from 'sequelize'
import {StatApp} from "../StatApp";
import {Conflux, format} from "js-conflux-sdk";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {TokenTool} from "./tool/TokenTool";
import {formatToBase32} from "../model/HexMap";
import {CONST} from "./common/constant";
import {ConfigInstance, QuoteOptions} from "../config/StatConfig";
import {KEY_TOKEN_QUOTE_DISABLE_PROXY, KEY_TOKEN_QUOTE_PROXY, KV} from "../model/KV";
import {getPricePeerUrl} from "./common/pricePeer";
import {calculateDexPriceChange24h} from "./common/dexPriceChange";
import {getSwappiPriceChanges} from "./common/swappiPriceChange";

const lodash = require('lodash');
const superagent = require('superagent');
const {ProxyAgent} = require('proxy-agent');
const BigFixed = require('bigfixed');
const {abi: abiSwappiFarmController} = require('./abi/SwappiFarmController');
const {abi: abiSwappiPair} = require('./abi/SwappiPair');
const {abi: abiSwappiRouter} = require('./abi/SwappiRouter');
const response = 13_000;
const deadline = 13_000;
const BN_REQUEST_MAX_ATTEMPTS = 5;
const BN_REQUEST_RETRY_DELAY_MS = 1_000;
const BN_REQUEST_MAX_RETRY_DELAY_MS = 60_000;
const CFX_CALL_MAX_ATTEMPTS = 3;
const CFX_CALL_RETRY_DELAY_MS = 500;
const DEFAULT_PEER_PROXY = 'http://127.0.0.1:1080';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEX_BASELINE_TOLERANCE_MS = 30 * 60 * 1000;
const DEX_HISTORY_RETENTION_MS = 48 * 60 * 60 * 1000;

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// A value of 5.2 means +5.2%; missing or invalid provider data stays null.
function parsePriceChange24h(value): number | null {
    if (value === null || value === undefined || value === '') return null;
    const change = Number(value);
    return Number.isFinite(change) ? change : null;
}

function shouldRetryBNRequestError(error) {
    const status = error?.status || error?.response?.status;
    return !status || status === 408 || status === 418 || status === 429 || status >= 500;
}

function getBNRequestRetryAfterMs(error) {
    const status = error?.status || error?.response?.status;
    const retryAfter = error?.response?.headers?.['retry-after'];
    return status === 418 || status === 429 ? parseRetryAfterMs(retryAfter) : null;
}

function parseRetryAfterMs(retryAfter) {
    if (!retryAfter) {
        return null;
    }

    const retryAfterSec = Number(retryAfter);
    if (Number.isFinite(retryAfterSec)) {
        return Math.max(0, retryAfterSec * 1000);
    }

    const retryAfterDateMs = Date.parse(retryAfter);
    if (Number.isFinite(retryAfterDateMs)) {
        return Math.max(0, retryAfterDateMs - Date.now());
    }

    return null;
}

function getBNRequestRetryDelayMs(error, attempt: number) {
    const retryAfterMs = getBNRequestRetryAfterMs(error);
    if (retryAfterMs !== null) {
        return retryAfterMs <= BN_REQUEST_MAX_RETRY_DELAY_MS ? retryAfterMs : null;
    }

    const backoffMs = BN_REQUEST_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
    const jitterMs = Math.floor(Math.random() * BN_REQUEST_RETRY_DELAY_MS);
    return Math.min(backoffMs + jitterMs, BN_REQUEST_MAX_RETRY_DELAY_MS);
}

export class TokenQuoteSync {
    private config: QuoteOptions;
    private cfx: Conflux;
    private readonly tokenTool: TokenTool;
    private readonly IS_BJ_REGION: boolean;
    private readonly bnIntervalSec: number;
    private readonly cmcIntervalSec: number;
    private readonly runIntervalSec = 10 * 60;
    private readonly disableAlertPullPeer: boolean;
    private bnRequestCooldownUntilMs = 0;
    private lastBnFetchAt = 0;
    private lastCmcFetchAt = 0;
    private lastDexHistoryCleanupAt = 0;

    constructor(cfx: Conflux, config: QuoteOptions) {
        if(config.enable && (!config.binanceAccessToken || !config.coinMarketCapAccessToken)) {
            throw new Error(`Token quote service configurations (binanceAccessToken,coinMarketCapAccessToken) should be provided!`);
        }

        this.config = config;
        this.cfx = cfx;
        this.tokenTool = new TokenTool(cfx);
        this.IS_BJ_REGION = ConfigInstance.serverTag.includes("bj");
        this.bnIntervalSec = config.binanceFetchIntervalSec || 5;
        this.cmcIntervalSec = config.coinMarketCapFetchIntervalSec || 720;
        this.disableAlertPullPeer = Boolean(config.disableAlertPullPeer);

        this.schedule().then();
    }

    public async query({address, source, convertSymbol = 'USDT'}) {
        const token = await Token.findOne({where: {base32: format.address(address, StatApp.networkId)}, attributes: ['id']});
        if (!token) return null;
        const where: any = {tokenId: token.id, convertSymbol};
        if (source) where.source = source;
        return await TokenQuoteTrack.findOne({where, order: [['priceUpdatedAt', 'DESC'], ['id', 'DESC']]});
    }

    public async schedule(delay: number = this.runIntervalSec * 1000) {
        const that = this

        async function repeat() {
            await that.run().catch(err => {
                safeAddErrorLog('token-x', 'quote-sync', err).then();
                console.log(`Failed to sync token quote`, err);
            });
            setTimeout(repeat, delay)
        }

        repeat().then()
        console.log(`Succeed to schedule token quote in ${delay / 1000}s interval`)
    }

    private async run() {
        const tokenList = await Token.findAll({
            attributes: [
                ['base32', 'address'],
                'name',
                'symbol',
                'cmcId',
                'bnId',
            ],
            where: {
                [Op.or]: [
                    {'bnId': {[Op.not]: null}},
                    {'cmcId': {[Op.not]: null}},
                ]
            },
            raw: true,
        });

        await this.pullPrice(tokenList).catch(e => {
            if (!this.disableAlertPullPeer) {
                safeAddErrorLog('stat-task', 'token-quote-peer', e).then();
            }
            console.log(`Failed to sync token quote from peer`, e);
        });
        await this.updateByMoonswap().catch(e => {
            safeAddErrorLog('stat-task', 'token-quote-moonswap', e).then();
            console.log(`Failed to sync token quote from moonswap`, e);
        });
        await this.updateBySwappi().catch(e => {
            safeAddErrorLog('stat-task', 'token-quote-swappi', e).then();
            console.log(`Failed to sync token quote from swappi`, e);
        });
        if (Date.now() - this.lastDexHistoryCleanupAt >= 60 * 60 * 1000) {
            await TokenQuoteHistory.destroy({where: {priceUpdatedAt: {[Op.lt]: new Date(Date.now() - DEX_HISTORY_RETENTION_MS)}}})
                .then(() => { this.lastDexHistoryCleanupAt = Date.now(); })
                .catch(e => {
                    safeAddErrorLog('stat-task', 'token-quote-history-cleanup', e).then();
                    console.log('Failed to clean token quote history', e);
                });
        }

        const now = Date.now();
        if (now - this.lastBnFetchAt >= this.bnIntervalSec * 1000) {
            this.lastBnFetchAt = now;
            await this.updateByBN(tokenList).catch(e => {
                safeAddErrorLog('stat-task', 'token-quote-bn', e).then();
                console.log(`Failed to sync token quote from BN`, e);
            });
        }

        if (now - this.lastCmcFetchAt >= this.cmcIntervalSec * 1000) {
            this.lastCmcFetchAt = now;
            await this.updateByCMC(tokenList).catch(e => {
                safeAddErrorLog('stat-task', 'quote-sync-cmc', e).then();
                console.log(`Failed to sync token quote from CMC`, e);
            });
        }

    }

    //======================================================================
    private async updateByBN(tokenList) {
        if (!tokenList?.length || this.IS_BJ_REGION) return;

        if (Date.now() < this.bnRequestCooldownUntilMs) {
            console.log(`Skip token quote from BN until ${new Date(this.bnRequestCooldownUntilMs).toISOString()}`);
            return;
        }

        const tokenArray = tokenList?.filter((token) => token.bnId);
        if (!tokenArray?.length) {
            return;
        }

        const resp = await this.getFromBNBatch(tokenArray.map(token => token.bnId));
        const quoteMap = lodash.keyBy(resp, 'symbol');
        const quoteArray = tokenArray.filter(token => quoteMap[`${token['bnId']}USDT`]).map(token => {
            return {
                address: token['address'],
                price: quoteMap[`${token['bnId']}USDT`].lastPrice,
                priceChange24h: quoteMap[`${token['bnId']}USDT`].priceChangePercent,
                src: 'BN',
            };
        });

        await this.upsertQuote(quoteArray);
    }

    private async getFromBNBatch(symbolArray, convert = 'USDT') {
        symbolArray = [...new Set(symbolArray)];
        const symbols = `[${symbolArray.map(symbol => `"${symbol}${convert}"`).join(",")}]`;

        let lastError;
        for (let attempt = 1; attempt <= BN_REQUEST_MAX_ATTEMPTS; attempt++) {
            try {
                const resp = await superagent.get('https://api.binance.com/api/v3/ticker/24hr')
                    .set('X-MBX-APIKEY', this.config.binanceAccessToken)
                    .timeout({response, deadline})
                    .query({
                        symbols,
                    });

                return lodash.get(resp, ['body']);
            } catch (e) {
                lastError = e;
                if (attempt < BN_REQUEST_MAX_ATTEMPTS && shouldRetryBNRequestError(e)) {
                    const delayMs = getBNRequestRetryDelayMs(e, attempt);
                    if (delayMs === null) {
                        const retryAfterMs = getBNRequestRetryAfterMs(e);
                        if (retryAfterMs !== null) {
                            this.bnRequestCooldownUntilMs = Date.now() + retryAfterMs;
                            console.log(`Pause token quote from BN until ${new Date(this.bnRequestCooldownUntilMs).toISOString()}`, e);
                        }
                        break;
                    }
                    console.log(`Failed to fetch token quote from BN, retry ${attempt}/${BN_REQUEST_MAX_ATTEMPTS} after ${delayMs}ms`, e);
                    await sleep(delayMs);
                } else {
                    break;
                }
            }
        }

        throw lastError;
    }

    //======================================================================
    private async updateByCMC(tokenList) {
        if (!tokenList?.length || this.IS_BJ_REGION) return;

        const tokenArray = tokenList?.filter((token) => token.cmcId);
        if (tokenArray.length === 0) {
            return;
        }

        const cmdIdArray = tokenArray.map(token => token.cmcId);
        const cmcIdQuoteMap = await this.getFromCMC(cmdIdArray, 'USDT');

        const quoteArray = tokenArray.map((token) => {
            const quote = cmcIdQuoteMap[token.cmcId] || {};
            return {
                address: token.address,
                price: quote.price || null,
                priceChange24h: quote.percent_change_24h,
                src: 'CMC',
            };
        });

        await this.upsertQuote(quoteArray);
    }

    private async getFromCMC(idArray, convert = 'USDT') {
        const resp = await superagent.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest')
            .set('X-CMC_PRO_API_KEY', this.config.coinMarketCapAccessToken)
            .timeout({response, deadline})
            .query({id: idArray.join(','), convert});
        return lodash.mapValues(resp.body.data, (each) => each.quote[convert]);
    }

    //======================================================================
    private async updateByMoonswap() {
        if (StatApp.networkId !== 1029) {
            return;
        }

        // define const
        const ROUTER = 'cfx:acam64yj323zd4t1fhybxh3jsg7hu4012yz9kakxs9';
        const wUSDT = "cfx:acf2rcsh8payyxpg6xj7b0ztswwh81ute60tsw35j7";
        const wETH = "cfx:acdrf821t59y12b4guyzckyuw2xf1gfpj2ba0x4sj6"; // direct swap
        const wCFX = "cfx:acg158kvr8zanb1bs048ryb6rtrhr283ma70vz70tx";
        const wTokens = new Set([wETH, wCFX]); // exclude tokens fetching price via binance
        const wITF = 'cfx:acc8599utu7nayj50w393eycznhv4e23g2ys6xmvf5'; // forward swap via wCFX
        const wFLUX = 'cfx:acgbjtsmfpex2mbn97dsygtkfrt952sp0psmh8pnvz';
        const TREA = 'cfx:acb9wkgbefcja9rkpds5ve4cm5643jmebae7xjzz8f';
        const YAO = 'cfx:acaucwuza1nm7wfj1bwkjttz7b0eh4ak7ur7fue1dy';
        const POOLGO = 'cfx:acc8ya1f2a2bfphxg5ax7a8h29k47d5xsebxfj24nd';
        const DAN = 'cfx:acbyzcbfpymaz43rr6s1gtx0fb08guj88uzc05rchf';
        const POS = 'cfx:acav5v98np8t3m66uw7x61yer1ja1jm0dpzj1zyzxv';
        const wMOON = 'cfx:achcuvuasx3t8zcumtwuf35y51sksewvca0h0hj71a'; // backward swap via wCFX
        const FC = 'cfx:achc8nxj7r451c223m18w2dwjnmhkd6rxawrvkvsy2';
        const wFOR = 'cfx:acc1uh4ftd4jhser99uk8nk8unkbz8ykmyxt0n27v5'; // forward swap via wETH
        const wLEND = 'cfx:acff13n54n4t02cy6uc8xfdxrf4enanr5jh6vy761g'; // backward swap via wETH

        // collect swap map
        const directSwap = {};
        const forwardSwap = {};
        const backwardSwap = {};
        directSwap[wETH] = {token0: wETH, token1: wUSDT};
        directSwap[wCFX] = {token0: wCFX, token1: wUSDT};
        forwardSwap[wITF] = {token0: wITF, token1: wCFX};
        forwardSwap[wFLUX] = {token0: wFLUX, token1: wCFX};
        forwardSwap[TREA] = {token0: TREA, token1: wCFX};
        forwardSwap[YAO] = {token0: YAO, token1: wCFX};
        forwardSwap[POOLGO] = {token0: POOLGO, token1: wCFX};
        forwardSwap[DAN] = {token0: DAN, token1: wCFX};
        forwardSwap[POS] = {token0: POS, token1: wCFX};
        backwardSwap[wMOON] = {token0: wCFX, token1: wMOON};
        backwardSwap[FC] = {token0: wCFX, token1: FC};
        forwardSwap[wFOR] = {token0: wFOR, token1: wETH};
        backwardSwap[wLEND] = {token0: wETH, token1: wLEND};

        // swap
        const tokenPriceMap = await this.swap(ROUTER, wUSDT, directSwap, forwardSwap, backwardSwap);

        // update price
        const quoteUri = 'https://moonswap.fi/analytics/token/';
        const quoteArray = Object.keys(tokenPriceMap)
            .filter(token => !wTokens.has(token) && Number.isFinite(Number(tokenPriceMap[token])) && Number(tokenPriceMap[token]) > 0)
            .map(token => ({address: token, price: tokenPriceMap[token], priceChange24h: null, src: 'moonswap',
                quoteUrl: `${quoteUri}${format.address(token, StatApp.networkId)}`}));

        await this.upsertQuote(quoteArray);
    }
    //======================================================================
    private async updateBySwappi() {
        if (StatApp.networkId !== 1030) {
            return;
        }

        // define const
        const FARM_CONTROLLER = '0xca49dbc049fca1916a1e51315b992a0d1eb308e7';
        const ROUTER = '0x62b0873055bf896dd869e172119871ac24aea305';
        const wUSDT_EVM = '0xfe97e85d13abd9c1c33384e796f10b73905637ce';
        const wBTC_EVM = '0x1f545487c62e5acfea45dcadd9c627361d1616d8';
        const wETH_EVM = '0xa47f43de2f9623acb395ca4905746496d2014d57';
        const wBNB_EVM = '0x94bd7a37d2ce24cc597e158facaa8d601083ffec';
        const wUSDC_EVM = '0x6963efed0ab40f6c3d7bda44a05dcf1437c44372';
        const wCFX_EVM = '0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b';
        const wTokens_EVM = new Set([wBTC_EVM, wETH_EVM, wBNB_EVM, wUSDC_EVM, wCFX_EVM]); // exclude tokens fetching price via binance
        const contractFarmController = this.cfx.Contract({address: FARM_CONTROLLER, abi: abiSwappiFarmController});
        const poolArray = await contractFarmController.getPoolInfo(0);

        // collect swap map
        const directSwap = {};
        const pairArray = [];
        for (const pool of poolArray) {
            const {token: pairAddr} = pool;
            const contractPair = this.cfx.Contract({address: pairAddr, abi: abiSwappiPair});
            const token0 = format.hexAddress(await contractPair.token0());
            const token1 = format.hexAddress(await contractPair.token1());
            pairArray.push({pairAddr, token0, token1});
            if(token0 !== wUSDT_EVM && token1 === wUSDT_EVM) {
                directSwap[token0] = {pairAddr, token0, token1};
            }
        }
        const forwardSwap = {};
        const backwardSwap = {};
        const directSet = new Set(Object.keys(directSwap));
        for (const pair of pairArray) {
            const {pairAddr, token0, token1} = pair;
            if((!directSet.has(token0) && token0 !== wUSDT_EVM) && directSet.has(token1)) {
                forwardSwap[token0] = {pairAddr, token0, token1};
            }
            if(directSet.has(token0) && (!directSet.has(token1) && token1 !== wUSDT_EVM)) {
                backwardSwap[token1] = {pairAddr, token0, token1};
            }
        }

        // swap
        const tokenPriceMap = await this.swap(ROUTER, wUSDT_EVM, directSwap, forwardSwap, backwardSwap);

        // update price
        const quoteUri = 'https://info.swappi.io/token/';
        const addresses = Object.keys(tokenPriceMap)
            .filter(token => !wTokens_EVM.has(token) && Number.isFinite(Number(tokenPriceMap[token])) && Number(tokenPriceMap[token]) > 0);
        const changes = await getSwappiPriceChanges(addresses).catch(e => {
            console.log('Failed to get Swappi 24-hour price changes; using local samples', e);
            return {};
        });
        const quoteArray = addresses
            .map(token => ({address: token, price: tokenPriceMap[token], priceChange24h: changes[token.toLowerCase()] ?? null, src: 'swappi',
                quoteUrl: `${quoteUri}${token}`}));

        await this.upsertQuote(quoteArray);
    }

    //======================================================================
    private async pullPrice(tokenList) {
        const url = getPricePeerUrl(this.config, ConfigInstance.serverTag, StatApp.networkId);
        if (
            !url ||
            !tokenList?.length
        ) {
            return;
        }

        const queryParams = tokenList.map(token => `addressArray=${token['address']}`).join('&');
        const req = superagent.get(`${url}/v1/token?${queryParams}`);
        const disableProxy = await KV.getSwitch(KEY_TOKEN_QUOTE_DISABLE_PROXY);
        if (!disableProxy) {
            const proxyUrl = await KV.getString(KEY_TOKEN_QUOTE_PROXY,
                process.env.HTTPS_PROXY || process.env.HTTP_PROXY || DEFAULT_PEER_PROXY);
            req.agent(new ProxyAgent({getProxyForUrl: () => proxyUrl}));
        }
        const resp = await req
            .timeout({response, deadline});
        const tokenArray = lodash.get(resp, ['body', 'data', 'list']) || lodash.get(resp, ['body', 'result', 'list']);

        const quoteArray = tokenArray.map(({address, price, priceSource, priceUpdatedAt, priceChange24h}) => ({
            address: formatToBase32(address),
            price,
            src: 'HK',
            peerSource: priceSource,
            priceUpdatedAt,
            priceChange24h,
        }));

        await this.upsertQuote(quoteArray);
    }

    //======================================================================
    private async swap(routerAddr, usdtAddr, directSwap, forwardSwap, backwardSwap) {
        const tokenPriceMap = {};

        // direct swap
        const directConvertTokens = Object.keys(directSwap);
        const contractRouter = this.cfx.Contract({address: routerAddr, abi: abiSwappiRouter});
        for (const token0 of directConvertTokens) {
            const [amount0, amount1] = await this.callAmountsOut(contractRouter, 100000, [token0, usdtAddr]);
            const token0Decimals = await getDecimals(this.tokenTool, token0);
            if(amount0 === BigInt(0)) continue
            tokenPriceMap[token0] = BigFixed(amount1).div(BigFixed(amount0)).div(BigFixed(10).pow(18 - token0Decimals))
                .toNumber();
        }

        // forward swap
        const forwardConvertTokens = Object.keys(forwardSwap);
        for (const token0 of forwardConvertTokens) {
            const {token1} = forwardSwap[token0];
            const ratio1 = await this.callAmountsOut(contractRouter, 100000, [token0, token1]);
            const ratio2 = await this.callAmountsOut(contractRouter, 100000, [token1, usdtAddr]);
            const token0Decimals = await getDecimals(this.tokenTool, token0);
            const token1Decimals = await getDecimals(this.tokenTool, token1);
            if(ratio1[0] === BigInt(0) || ratio2[0] === BigInt(0)) continue
            tokenPriceMap[token0] = BigFixed(ratio1[1]).div(BigFixed(ratio1[0])).div(BigFixed(10).pow(token1Decimals - token0Decimals))
                .mul(BigFixed(ratio2[1]).div(BigFixed(ratio2[0])).div(BigFixed(10).pow(18 - token1Decimals)))
                .toNumber();
        }

        // backward swap
        const backwardConvertTokens = Object.keys(backwardSwap);
        for (const token1 of backwardConvertTokens) {
            const {token0} = backwardSwap[token1];
            const ratio1 = await this.callAmountsOut(contractRouter, 100000, [token0, token1]);
            const ratio2 = await this.callAmountsOut(contractRouter, 100000, [token0, usdtAddr]);
            const token0Decimals = await getDecimals(this.tokenTool, token0);
            const token1Decimals = await getDecimals(this.tokenTool, token1);
            if(ratio1[1] === BigInt(0) || ratio2[0] === BigInt(0)) continue
            tokenPriceMap[token1] = BigFixed(ratio1[0]).div(BigFixed(ratio1[1])).div(BigFixed(10).pow(token0Decimals - token1Decimals))
                .mul(BigFixed(ratio2[1]).div(BigFixed(ratio2[0])).div(BigFixed(10).pow(18 - token0Decimals)))
                .toNumber();
        }

        return tokenPriceMap;
    }

    private async callAmountsOut(contractRouter: any, amount: number, path: string[]) {
        let lastError: any;
        for (let attempt = 1; attempt <= CFX_CALL_MAX_ATTEMPTS; attempt++) {
            try {
                const confirmedEpoch = await this.cfx.getEpochNumber('latest_confirmed');
                return await contractRouter.getAmountsOut(amount, path).call({}, confirmedEpoch);
            } catch (error) {
                lastError = error;
                if (!this.isCfxEpochStateError(error) || attempt === CFX_CALL_MAX_ATTEMPTS) throw error;
                const delay = CFX_CALL_RETRY_DELAY_MS * attempt;
                console.log(`Retry cfx_call getAmountsOut attempt ${attempt + 1}/${CFX_CALL_MAX_ATTEMPTS} after ${delay}ms`, error?.code || error?.message || error);
                await sleep(delay);
            }
        }
        throw lastError;
    }

    private isCfxEpochStateError(error: any): boolean {
        return Number(error?.code) === -32016 || Number(error?.error?.code) === -32016 ||
            Number(error?.data?.code) === -32016;
    }

    //======================================================================
    private async upsertQuote(quoteArray) {
        const {wrappedUSDT, wrappedUSDT0} = CONST.WRAPPED_TOKENS[StatApp.networkId] || {};
        wrappedUSDT && quoteArray.push({address: wrappedUSDT, price: 1, priceChange24h: null, src: 'wrapped'});
        wrappedUSDT0 && quoteArray.push({address: wrappedUSDT0, price: 1, priceChange24h: null, src: 'wrapped'});

        await Promise.all(quoteArray.map(async quote => {
            const {address, price, quoteUrl, src = 'unknown', priceUpdatedAt = new Date()} = quote;
            const peerSource = src === 'HK' && typeof quote.peerSource === 'string'
                ? quote.peerSource.slice(0, 32) || null : null;
            const base32 = format.address(address, StatApp.networkId);
            const dbToken: Token = await Token.findOne({where: {base32}});
            if (!dbToken) return;
            const totalSupply = await this.tokenTool.getTokenTotalSupply(base32);

            if (dbToken) {
                let totalPrice = (price && totalSupply && Number.isInteger(dbToken.decimals))
                    ? BigFixed(price).mul(totalSupply).div(BigFixed(10).pow(dbToken.decimals)).toNumber()
                    : null;
                totalPrice = totalPrice === 0 ? null : totalPrice;

                const quoteTime = priceUpdatedAt == null || priceUpdatedAt === '' ? null : new Date(priceUpdatedAt);
                const validQuoteTime = !quoteTime || Number.isNaN(quoteTime.getTime()) ? new Date() : quoteTime;
                let priceChange24h = parsePriceChange24h(quote.priceChange24h);
                if (src === 'swappi' || src === 'moonswap') {
                    const sampledChange = await this.recordDexQuoteAndGetChange(dbToken.id, src, price, validQuoteTime);
                    if (priceChange24h === null) priceChange24h = sampledChange;
                }
                const token = {price, totalSupply, totalPrice, priceSource: src, priceChange24h,
                    priceUpdatedAt: validQuoteTime, updatedAt: new Date()};
                if(!dbToken.quoteUrl && quoteUrl) {
                    lodash.assign(token, {quoteUrl});
                }

                await Token.update(token, {where: {id: dbToken.id}});
                await TokenQuoteTrack.upsert({tokenId: dbToken.id, source: src, peerSource, convertSymbol: 'USDT',
                    price, priceChange24h, priceUpdatedAt: token.priceUpdatedAt});
            }
        }));
    }

    private async recordDexQuoteAndGetChange(tokenId: number, source: string, price: number, priceUpdatedAt: Date): Promise<number | null> {
        if (!Number.isFinite(Number(price)) || Number(price) <= 0) return null;
        const baselineAt = new Date(priceUpdatedAt.getTime() - DAY_MS);
        const baseline = await TokenQuoteHistory.findOne({
            where: {
                tokenId, source, convertSymbol: 'USDT',
                priceUpdatedAt: {[Op.between]: [new Date(baselineAt.getTime() - DEX_BASELINE_TOLERANCE_MS), baselineAt]},
            },
            order: [['priceUpdatedAt', 'DESC'], ['id', 'DESC']],
            attributes: ['price'],
            raw: true,
        });
        await TokenQuoteHistory.create({tokenId, source, convertSymbol: 'USDT', price, priceUpdatedAt});
        return baseline ? calculateDexPriceChange24h(price, baseline.price) : null;
    }
}

async function getDecimals(tokenTool: TokenTool, addr: string) {
    const base32 = formatToBase32(addr);
    const token = await Token.findOne({where: {base32}, attributes: ['decimals'], raw: true});
    if (token?.decimals) {
        return token.decimals;
    }
    return tokenTool.contract.decimals().call({to: addr}, ).then(Number);
}
