import {Token} from "../model/Token";
import {TokenQuoteTrack} from "../model/TokenQuoteTrack";
import {Op} from 'sequelize'
import {StatApp} from "../StatApp";
import {Conflux, format} from "js-conflux-sdk";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {TokenTool} from "./tool/TokenTool";
import {formatToBase32} from "../model/HexMap";
import {CONST} from "./common/constant";
import {ConfigInstance, QuoteOptions} from "../config/StatConfig";

const lodash = require('lodash');
const superagent = require('superagent');
const BigFixed = require('bigfixed');
const {abi: abiSwappiFarmController} = require('./abi/SwappiFarmController');
const {abi: abiSwappiPair} = require('./abi/SwappiPair');
const {abi: abiSwappiRouter} = require('./abi/SwappiRouter');
const response = 3_000;
const deadline = 3_000;
const PEER_URLS = {
    1029: 'https://www.confluxscan.org',
    1030: 'https://evm.confluxscan.org',
};

export class TokenQuoteSync {
    private config: QuoteOptions;
    private cfx: Conflux;
    private readonly tokenTool: TokenTool;
    private tick = -1; // 1 sec per tick by default
    private readonly IS_BJ_REGION: boolean;

    constructor(cfx: Conflux, config: QuoteOptions) {
        if(config.enable && (!config.binanceAccessToken || !config.coinMarketCapAccessToken)) {
            throw new Error(`Token quote service configurations (binanceAccessToken,coinMarketCapAccessToken) should be provided!`);
        }

        this.config = config;
        this.cfx = cfx;
        this.tokenTool = new TokenTool(cfx);
        this.IS_BJ_REGION = ConfigInstance.serverTag.includes("bj");

        this.schedule().then();
    }

    public async query({address, convertSymbol = 'USDT'}) {
        return await TokenQuoteTrack.findOne({where: {[Op.and]: [{address}, {convertSymbol}]}});
    }

    public async schedule(delay: number = 1_000) {
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
        this.tick ++;

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
            safeAddErrorLog('stat-task', 'token-quote-peer', e).then();
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
        // every 5 sec
        if (this.tick % 5 === 0) {
            await this.updateByBN(tokenList).catch(e => {
                safeAddErrorLog('stat-task', 'token-quote-bn', e).then();
                console.log(`Failed to sync token quote from BN`, e);
            });
        }

        // every 60 sec
        if (this.tick % 60 === 0) {
            await this.updateByCMC(tokenList).catch(e => {
                safeAddErrorLog('stat-task', 'quote-sync-cmc', e).then();
                console.log(`Failed to sync token quote from CMC`, e);
            });
        }

        this.tick = this.tick % 60 === 0 ? 0 : this.tick;
    }

    //======================================================================
    private async updateByBN(tokenList) {
        if (!tokenList?.length || this.IS_BJ_REGION) return;

        const tokenArray = tokenList?.filter((token) => token.bnId);
        if (!tokenArray?.length) {
            return;
        }

        const resp = await this.getFromBNBatch(tokenArray.map(token => token.bnId));
        const quoteMap = lodash.keyBy(resp, 'symbol');
        const quoteArray = tokenArray.map(token => {
            return {
                address: token['address'],
                price: quoteMap[`${token['bnId']}USDT`]['price'],
                src: 'BN',
            };
        });

        await this.upsertQuote(quoteArray);
    }

    private async getFromBNBatch(symbolArray, convert = 'USDT') {
        symbolArray = [...new Set(symbolArray)];
        const symbols = `[${symbolArray.map(symbol => `"${symbol}${convert}"`).join(",")}]`;

        const resp = await superagent.get('https://api.binance.com/api/v3/ticker/price')
            .set('X-MBX-APIKEY', this.config.binanceAccessToken)
            .timeout({response, deadline})
            .query({
                symbols,
            });

        return lodash.get(resp, ['body']);
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
        const quoteArray = Object.keys(tokenPriceMap).filter(token => !wTokens.has(token))
            .map(token => ({address: token, price: tokenPriceMap[token], src: 'moonswap',
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
        const quoteArray = Object.keys(tokenPriceMap).filter(token => !wTokens_EVM.has(token))
            .map(token => ({address: token, price: tokenPriceMap[token], src: 'swappi',
                quoteUrl: `${quoteUri}${token}`}));

        await this.upsertQuote(quoteArray);
    }

    //======================================================================
    private async pullPrice(tokenList) {
        const url = PEER_URLS[StatApp.networkId];
        if (
            !url ||
            !tokenList?.length ||
            !this.IS_BJ_REGION
        ) {
            return;
        }

        const queryParams = tokenList.map(token => `addressArray=${token['address']}`).join('&');
        const resp = await superagent.get(`${url}/v1/token?${queryParams}`)
            .timeout({response, deadline});
        const tokenArray = lodash.get(resp, ['body', 'data', 'list']) || lodash.get(resp, ['body', 'result', 'list']);

        const quoteArray = tokenArray.map(({address, name, symbol, price}) => ({
            address: formatToBase32(address),
            price,
            src: 'HK',
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
            const [amount0, amount1] = await contractRouter.getAmountsOut(100000, [token0, usdtAddr]);
            const token0Decimals = await getDecimals(this.tokenTool, token0);
            if(amount0 === BigInt(0)) continue
            tokenPriceMap[token0] = BigFixed(amount1).div(BigFixed(amount0)).div(BigFixed(10).pow(18 - token0Decimals))
                .toNumber();
        }

        // forward swap
        const forwardConvertTokens = Object.keys(forwardSwap);
        for (const token0 of forwardConvertTokens) {
            const {token1} = forwardSwap[token0];
            const ratio1 = await contractRouter.getAmountsOut(100000, [token0, token1]);
            const ratio2 = await contractRouter.getAmountsOut(100000, [token1, usdtAddr]);
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
            const ratio1 = await contractRouter.getAmountsOut(100000, [token0, token1]);
            const ratio2 = await contractRouter.getAmountsOut(100000, [token0, usdtAddr]);
            const token0Decimals = await getDecimals(this.tokenTool, token0);
            const token1Decimals = await getDecimals(this.tokenTool, token1);
            if(ratio1[1] === BigInt(0) || ratio2[0] === BigInt(0)) continue
            tokenPriceMap[token1] = BigFixed(ratio1[0]).div(BigFixed(ratio1[1])).div(BigFixed(10).pow(token0Decimals - token1Decimals))
                .mul(BigFixed(ratio2[1]).div(BigFixed(ratio2[0])).div(BigFixed(10).pow(18 - token0Decimals)))
                .toNumber();
        }

        return tokenPriceMap;
    }

    //======================================================================
    private async upsertQuote(quoteArray) {
        const {wrappedUSDT, wrappedUSDT0} = CONST.WRAPPED_TOKENS[StatApp.networkId] || {};
        wrappedUSDT && quoteArray.push({address: wrappedUSDT, price: 1});
        wrappedUSDT0 && quoteArray.push({address: wrappedUSDT0, price: 1});

        quoteArray.map(async quote => {
            const {address, price, quoteUrl} = quote;
            const base32 = format.address(address, StatApp.networkId);
            const dbToken: Token = await Token.findOne({where: {base32}});
            const totalSupply = await this.tokenTool.getTokenTotalSupply(base32);

            if (dbToken) {
                let totalPrice = (price && totalSupply && Number.isInteger(dbToken.decimals))
                    ? BigFixed(price).mul(totalSupply).div(BigFixed(10).pow(dbToken.decimals)).toNumber()
                    : null;
                totalPrice = totalPrice === 0 ? null : totalPrice;

                const token = {price, totalSupply, totalPrice, updatedAt: new Date()};
                if(!dbToken.quoteUrl && quoteUrl) {
                    lodash.assign(token, {quoteUrl});
                }

                await Token.update(token, {where: {id: dbToken.id}});
            }
        });
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
