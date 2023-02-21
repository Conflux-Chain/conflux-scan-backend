import {Token} from "../model/Token";
import {TokenQuoteTrack} from "../model/TokenQuoteTrack";
import {Op} from 'sequelize'
import {toBase32} from "./tool/AddressTool";
import {StatApp} from "../StatApp";

const lodash = require('lodash');
const superagent = require('superagent');
const BigFixed = require('bigfixed');
const {abi} = require('./abi/MoonswapRoute');
const response = 10_000;
const deadline = 10_000;

export class QuoteSync {
    private app;
    private cfx;
    private moonSwapRouteAddress = 'cfx:acam64yj323zd4t1fhybxh3jsg7hu4012yz9kakxs9';
    private wCFXAddress = "cfx:acg158kvr8zanb1bs048ryb6rtrhr283ma70vz70tx";
    private cETHAddress = "cfx:acdrf821t59y12b4guyzckyuw2xf1gfpj2ba0x4sj6";
    private cUSDTAddress = "cfx:acf2rcsh8payyxpg6xj7b0ztswwh81ute60tsw35j7";
    private viaWCFXSet = new Set<string>(['cITF', 'cFLUX', 'TREA', 'YAO', 'POOLGO', 'DAN', 'POS']);
    private viaCETHSet = new Set<string>(['cFOR']);
    private viaCETHUnilateralSet = new Set<string>(['cLEND']);

    private swappiRouteAddress = '0x62b0873055bf896dd869e172119871ac24aea305';
    private wCFXAddressEVM = '0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b';
    private cUSDTAddressEVM = "0xfe97e85d13abd9c1c33384e796f10b73905637ce";
    private straightToCUSDTEVM = new Set<string>(['PPI', 'xCFX']);
    private viaWCFXUnilateralSetEVM = new Set<string>(['GOL', 'NUT', 'AUSD']);
    private TOKEN_PPI = {address: "0x22f41abf77905f50df398f21213290597e7414dd", name: 'Swappi Token', symbol: 'PPI'};
    private TOKEN_GOL = {address: "0xa4b59aa3de2af57959c23e2c9c89a2fcb408ce6a", name: 'Goledo Token', symbol: 'GOL'};
    private TOKEN_NUT = {address: "0xfe197e7968807b311d476915db585831b43a7e3b", name: 'Nucleon Governance Token', symbol: 'NUT'};
    private TOKEN_xCFX = {address: "0x889138644274a7dc602f25a7e7d53ff40e6d0091", name: 'X nucleon CFX', symbol: 'xCFX'};
    private TOKEN_AUSD = {address: "0xff33b107a0e2c0794ac43c3ffaf637fcea3697cf", name: 'AUSD Stablecoin', symbol: 'AUSD'};

    constructor(app: any) {
        this.app = app;
        this.cfx = app.cfx;
    }

    public async query({address, convertSymbol = 'USDT'}) {
        return await TokenQuoteTrack.findOne({where: {[Op.and]: [{address}, {convertSymbol}]}});
    }

    public async schedule(delay: number = 1000 * 60 * 60) {
        console.log(`schedule token_quote sync with delay: ${delay}`)
        const that = this

        async function repeat() {
            await that.run().catch(err => {
                console.log(`sync token_quote fail: `, err);
            });
            setTimeout(repeat, delay)
        }

        repeat().then()
    }

    private async run() {
        const rawList = await Token.findAll({
            attributes: [
                ['base32', 'address'],
                'name',
                'symbol',
                'marketCapId',
                'moonDexSymbol',
                'binanceSymbol',
                'moonSwapSymbol'
            ],
            where: {
                [Op.or]: [
                    {'marketCapId': {[Op.not]: null}},
                    {'moonDexSymbol': {[Op.not]: null}},
                    {'binanceSymbol': {[Op.not]: null}},
                    {'moonSwapSymbol': {[Op.not]: null}},
                ]
            },
        });
        const tokenList = rawList.map(row => row.toJSON());
        if (tokenList.length === 0) {
            return;
        }

        await this.pullPrice(tokenList).catch((e) => console.log(`quote_sync.fromHk ${e?.code}`));
        await this.updateFromMarketCap(tokenList).catch((e) => console.log(`quote_sync.fromCoinMarketCap ${e?.code}`));
        await this.updateFromMoonDex(tokenList).catch((e) => console.log(`quote_sync.fromMoonDex ${e?.code}`));
        await this.updateFromBinance(tokenList).catch((e) => console.log(`quote_sync.fromBinance ${e?.code}`));
        await this.updateFromMoonSwap(tokenList).catch((e) => console.log(`quote_sync.fromMoonSwap ${e?.code}`));
        if (StatApp.networkId === 1030) {
            await this.updateFromSwappi(tokenList).catch((e) => console.log(`quote_sync.fromSwappi ${e?.code}`));
        }
    }

    //======================================================================
    private async updateFromMarketCap(tokenList) {
        const {
            app: {config},
        } = this;

        const convertSymbolArray: Array<string> = config.quoteConvertSymbolArray;
        if (convertSymbolArray.length === 0) {
            return;
        }
        const tokenArray = tokenList?.filter((token) => token.marketCapId);
        if (tokenArray.length === 0) {
            return;
        }

        convertSymbolArray.map(async (convert) => {
            const tokenMarketCapIdArray = tokenArray.map((token) => {
                return token.marketCapId;
            });

            const marketCapIdToQuote = await this.getFromMarketCap(tokenMarketCapIdArray, convert).catch(e => {
                console.log(`quote_sync.fromCoinMarketCap ${e?.code}`)
                return undefined
            });
            if (marketCapIdToQuote === undefined) {
                return
            }
            const quoteArray = tokenArray.map((token) => {
                const quote = marketCapIdToQuote[token.marketCapId] || {};
                return {
                    address: token.address,
                    name: token.name,
                    symbol: token.symbol,
                    convertSymbol: convert,
                    price: quote.price || null,
                };
            });
            await this.upsertQuote(quoteArray);
        });
    }

    private async getFromMarketCap(idArray, convert = 'USDT') {
        const {
            app: {config},
        } = this;

        const resp = await superagent.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest')
            .set('X-CMC_PRO_API_KEY', config.marketCapToken)
            .timeout({response, deadline})
            .query({id: idArray.join(','), convert});
        return lodash.mapValues(resp.body.data, (each) => each.quote[convert]);
    }

    //======================================================================
    private async updateFromMoonDex(tokenList) {
        const tokenArray = tokenList?.filter((token) => token.moonDexSymbol);
        if (tokenArray.length === 0) {
            return;
        }

        const quoteArray = await Promise.all(tokenArray.map(async (token) => {
            const quote = await this.getFromMoonDex(token.moonDexSymbol) || {};
            const result = {
                address: token.address,
                name: token.name,
                symbol: token.symbol,
                convertSymbol: 'USDT',
                price: quote.price || null,
            };
            return result;
        }));
        await this.upsertQuote(quoteArray);
    }

    private async getFromMoonDex(symbol, convert = 'USDT') {
        const resp = await superagent.get('https://api.moondex.io/opt/trade/pairs')
            .timeout({response, deadline})
            .query({pair: `${symbol}-${convert}`});
        return lodash.get(resp, ['body', 'data', 0]);
    }

    //======================================================================
    private async updateFromBinance(tokenList) {
        const tokenArray = tokenList?.filter((token) => token.binanceSymbol);
        if (tokenArray.length === 0) {
            return;
        }

        const quoteArray = await Promise.all(tokenArray.map(async ({address, name, symbol, binanceSymbol}) => {
            const quote = await this.getFromBinance(binanceSymbol) || {};
            return {
                address,
                name,
                symbol,
                convertSymbol: 'USDT',
                price: quote || null,
            };
        }));
        await this.upsertQuote(quoteArray);
    }

    private async getFromBinance(symbol, convert = 'USDT') {
        const {
            app: {config},
        } = this;

        const resp = await superagent.get('https://api.binance.com/api/v3/ticker/price')
            .set('X-MBX-APIKEY', config.binanceToken)
            .timeout({response, deadline})
            .query({
                symbol: `${symbol}${convert}`,
            });
        return lodash.get(resp, ['body', 'price']);
    }

    //======================================================================
    private async updateFromMoonSwap(tokenList) {
        const tokenArray = tokenList?.filter((token) => token.moonSwapSymbol);
        if (tokenArray.length === 0) {
            return;
        }

        const quoteArray = await Promise.all(tokenArray.map(async ({address, name, symbol}) => {
            const quoteMap = await this.getFromMoonSwapSite() || {};
            if (quoteMap[address] === undefined) {
                quoteMap[address] = await this.getFromMoonSwapContract(symbol, address);
            }
            return {
                address,
                name,
                symbol,
                convertSymbol: 'USDT',
                price: quoteMap[address] || null,
            };
        }));
        await this.upsertQuote(quoteArray);
    }

    private async getFromMoonSwapSite() {
        const {
            app: {config},
        } = this;

        const quoteMap = {};
        const resp = await superagent.get('https://moonswap.fi/api/route/opt/swap/main/token-price')
            .timeout({response, deadline});
        const data = lodash.get(resp, ['body', 'data']);
        data.forEach(item => quoteMap[item.contract_address] = item.price_usd);
        return quoteMap;
    }


    private async getFromMoonSwapContract(symbol = undefined, address = undefined) {
        const contract = this.cfx.Contract({address: this.moonSwapRouteAddress, abi});

        //cYAO-wCFX wCFX-cUSDT
        //cFOR-cETH cETH-cUSDT
        let price;
        if (this.viaWCFXSet.has(symbol) || this.viaCETHSet.has(symbol)) {
            const viaAddress = this.viaWCFXSet.has(symbol) ? this.wCFXAddress : this.cETHAddress;
            const ratio1 = await contract.getAmountsOut(100000, [address, viaAddress]);
            const ratio2 = await contract.getAmountsOut(100000, [viaAddress, this.cUSDTAddress]);
            price = BigFixed(ratio1[1]).div(BigFixed(ratio1[0])).mul(BigFixed(ratio2[1])
                .div(BigFixed(ratio2[0]))).toNumber();
        }
        //cETH-cLEND cETH-cUSDT
        if (this.viaCETHUnilateralSet.has(symbol)) {
            const viaAddress = this.cETHAddress;
            const ratio1 = await contract.getAmountsOut(100000, [viaAddress, address]);
            const ratio2 = await contract.getAmountsOut(100000, [viaAddress, this.cUSDTAddress]);
            price = BigFixed(ratio1[0]).div(BigFixed(ratio1[1])).mul(BigFixed(ratio2[1])
                .div(BigFixed(ratio2[0]))).toNumber();
        }
        return price;
    }

    //======================================================================
    private async updateFromSwappi(tokenList) {
        const tokenArray = tokenList?.filter((token) => token.swappiSymbol);
        tokenArray.push(this.TOKEN_PPI);
        tokenArray.push(this.TOKEN_GOL);
        tokenArray.push(this.TOKEN_NUT);
        tokenArray.push(this.TOKEN_xCFX);
        tokenArray.push(this.TOKEN_AUSD);
        if (tokenArray.length === 0) {
            return;
        }

        const quoteArray = await Promise.all(tokenArray.map(async ({address, name, symbol}) => {
            const quote = await this.getFromSwappiContractPlus(symbol, address);
            return {
                address: toBase32(address),
                name,
                symbol,
                convertSymbol: 'USDT',
                price: quote || null,
            };
        }));
        await this.upsertQuote(quoteArray);
    }

    /*private async getFromSwappiContract(symbol = undefined, address = undefined) {
        const contract = this.cfx.Contract({address: this.swappiRouteAddress, abi});

        const [amount0, amount1] = await contract.getAmountsOut(100000, [address, this.cUSDTAddressEVM]);
        return BigFixed(amount1).div(BigFixed(amount0)).toNumber();
    }*/

    private async getFromSwappiContractPlus(symbol = undefined, address = undefined) {
        const contract = this.cfx.Contract({address: this.swappiRouteAddress, abi});

        //PPI-USDT
        let price;
        if (this.straightToCUSDTEVM.has(symbol)) {
            const srcAddr = symbol === this.TOKEN_xCFX.symbol ? this.wCFXAddressEVM : address;
            const [amount0, amount1] = await contract.getAmountsOut(100000, [srcAddr, this.cUSDTAddressEVM]);
            price = BigFixed(amount1).div(BigFixed(amount0)).toNumber();
        }
        //CFX-GOL CFX-USDT
        //CFX-NUT CFX-USDT
        if (this.viaWCFXUnilateralSetEVM.has(symbol)) {
            const viaAddress = this.wCFXAddressEVM;
            const ratio1 = await contract.getAmountsOut(100000, [viaAddress, address]);
            const ratio2 = await contract.getAmountsOut(100000, [viaAddress, this.cUSDTAddressEVM]);
            price = BigFixed(ratio1[0]).div(BigFixed(ratio1[1])).mul(BigFixed(ratio2[1])
                .div(BigFixed(ratio2[0]))).toNumber();
        }
        return price;
    }

    //======================================================================
    private async pullPrice(tokenList) {
        const queryParams = tokenList.map(token => `addressArray=${token['address']}`).join('&');
        const resp = await superagent.get(`https://www.confluxscan.io/v1/token?${queryParams}`)
            .timeout({response, deadline});
        const tokenArray = lodash.get(resp, ['body', 'data', 'list']);

        const quoteArray = tokenArray.map(({address, name, symbol, price}) => ({
            address: toBase32(address),
            name,
            symbol,
            convertSymbol: 'USDT',
            price,
        }));
        await this.upsertQuote(quoteArray);
    }

    //======================================================================
    private async upsertQuote(quoteArray) {
        quoteArray.map(async quote => {
            const {address, convertSymbol, price} = quote;
            /*const dbQuote: TokenQuoteTrack = await TokenQuoteTrack.findOne({where: {address, convertSymbol}});
            if (dbQuote) {
                await dbQuote.update(lodash.assign(quote, {updatedAt: Date.now()}), {where: {id: dbQuote.id}});
            } else {
                await TokenQuoteTrack.add(quote);
            }*/

            const dbToken: Token = await Token.findOne({where: {base32: address}});
            if (dbToken) {
                let totalPrice = (price && dbToken.totalSupply && Number.isInteger(dbToken.decimals))
                    ? BigFixed(price).mul(dbToken.totalSupply).div(BigFixed(10).pow(dbToken.decimals)).toNumber()
                    : null;
                totalPrice = totalPrice === 0 ? null : totalPrice;
                await Token.update({price, totalPrice, updatedAt: new Date()}, {where: {id: dbToken.id}});
            }
        });
    }
}
