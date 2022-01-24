import {Token} from "../model/Token";
import {TokenQuoteTrack} from "../model/TokenQuoteTrack";
import {Op} from 'sequelize'
const lodash = require('lodash');
const superagent = require('superagent');
const BigFixed = require('bigfixed');
const { abi } = require('./abi/MoonswapRoute');

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

  constructor(app: any) {
    this.app = app;
    this.cfx = app.cfx;
  }

  public async query({ address, convertSymbol='USDT' }) {
    return await TokenQuoteTrack.findOne({where: {[Op.and]: [{address},{convertSymbol}]}});
  }

  public async schedule(delay: number = 1000 * 60 * 60) {
    console.log(`schedule token_quote sync with delay: ${delay}`)
    const that = this
    async function repeat() {
      await that.run().catch(err=>{
        console.log(`sync token_quote fail: `, err);
      });
      setTimeout(repeat, delay)
    }
    repeat().then()
  }

  private async run() {
    const rawList = await Token.findAll({
      attributes: [['base32','address'], 'name', 'symbol', 'marketCapId','moonDexSymbol','binanceSymbol','moonSwapSymbol'],
    });
    const tokenList = rawList.map(row => row.toJSON());
    if(tokenList.length === 0) {
      return;
    }
    await this.updateFromMarketCap(tokenList).catch((e) => console.log({ src: 'updateFromMarketCap', msg: e }));
    await this.updateFromMoonDex(tokenList).catch((e) => console.log({ src: 'updateFromMoonDex', msg: e }));
    await this.updateFromBinance(tokenList).catch((e) => console.log({ src: 'updateFromBinance', msg: e }));
    await this.updateFromMoonSwap(tokenList).catch((e) => console.log({ src: 'updateFromMoonSwap', msg: e }));
  }

  //======================================================================
  private async updateFromMarketCap(tokenList) {
    const {
      app: { config },
    } = this;

    const convertSymbolArray: Array<string> = config.quoteConvertSymbolArray;
    if(convertSymbolArray.length === 0){
        return;
    }
    const tokenArray = tokenList?.filter((token) => token.marketCapId);
    if (tokenArray.length === 0) {
      return;
    }

    convertSymbolArray.map( async (convert) =>  {
      const tokenMarketCapIdArray = tokenArray.map((token) => {
        return token.marketCapId;
      });

      const marketCapIdToQuote = await this.getFromMarketCap(tokenMarketCapIdArray, convert).catch(err=>{
        console.log(`error getFromMarketCap:`, err.toString())
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
      app: { config },
    } = this;

    const response = await superagent.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest')
      .set('X-CMC_PRO_API_KEY', config.marketCapToken)
      .query({ id: idArray.join(','), convert });
    // console.log({ status: response.status, text: response.text }); // for debug
    return lodash.mapValues(response.body.data, (each) => each.quote[convert]);
  }

  //======================================================================
  private async updateFromMoonDex(tokenList) {
    const tokenArray = tokenList?.filter((token) => token.moonDexSymbol);
    if (tokenArray.length === 0) {
      return;
    }

    const quoteArray = await Promise.all(tokenArray.map(async (token) => {
      const quote = await this.getFromMoonDex(token.moonDexSymbol) || {};
      const result =  {
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
    const response = await superagent.get('https://api.moondex.io/opt/trade/pairs').query({
      pair: `${symbol}-${convert}`,
    });
    return lodash.get(response, ['body', 'data', 0]);
  }

  //======================================================================
  private async updateFromBinance(tokenList) {
    const tokenArray = tokenList?.filter((token) => token.binanceSymbol);
    if (tokenArray.length === 0) {
      return;
    }

    const quoteArray = await Promise.all(tokenArray.map(async ({ address, name, symbol, binanceSymbol }) => {
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
      app: { config },
    } = this;

    const response = await superagent.get('https://api.binance.com/api/v3/ticker/price')
        .set('X-MBX-APIKEY', config.binanceToken)
        .query({
          symbol: `${symbol}${convert}`,
        });
    // console.log({ status: response.status, text: response.text }); // for debug
    return lodash.get(response, ['body', 'price']);
  }

  //======================================================================
  private async updateFromMoonSwap(tokenList) {
    const tokenArray = tokenList?.filter((token) => token.moonSwapSymbol);
    if (tokenArray.length === 0) {
      return;
    }

    const quoteArray = await Promise.all(tokenArray.map(async ({ address, name, symbol }) => {
      const quoteMap = await this.getFromMoonSwapSite() || {};
      if(quoteMap[address] === undefined){
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
      app: { config },
    } = this;

    const quoteMap = {};
    const response = await superagent.get('https://moonswap.fi/api/route/opt/swap/main/token-price');
    // console.log({ status: response.status, text: response.text }); // for debug
    const data = lodash.get(response, ['body', 'data']);
    data.forEach(item => quoteMap[item.contract_address] = item.price_usd);
    return quoteMap;
  }


  private async getFromMoonSwapContract(symbol = undefined, address = undefined){
    const contract = this.cfx.Contract({ address : this.moonSwapRouteAddress, abi});

    //cYAO-wCFX wCFX-cUSDT
    //cFOR-cETH cETH-cUSDT
    let price;
    if(this.viaWCFXSet.has(symbol) || this.viaCETHSet.has(symbol)){
      const viaAddress = this.viaWCFXSet.has(symbol) ? this.wCFXAddress : this.cETHAddress;
      const ratio1 = await contract.getAmountsOut(100000, [address, viaAddress]);
      const ratio2 = await contract.getAmountsOut(100000, [viaAddress, this.cUSDTAddress]);
      price = BigFixed(ratio1[1]).div(BigFixed(ratio1[0])).mul(BigFixed(ratio2[1]).div(BigFixed(ratio2[0]))).toNumber();
    }
    //cETH-cLEND cETH-cUSDT
    if(this.viaCETHUnilateralSet.has(symbol)) {
      const viaAddress = this.cETHAddress;
      const ratio1 = await contract.getAmountsOut(100000, [viaAddress, address]);
      const ratio2 = await contract.getAmountsOut(100000, [viaAddress, this.cUSDTAddress]);
      price = BigFixed(ratio1[0]).div(BigFixed(ratio1[1])).mul(BigFixed(ratio2[1]).div(BigFixed(ratio2[0]))).toNumber();
    }
    return price;
  }

  //======================================================================
  private async upsertQuote(quoteArray){
    quoteArray.map(async quote => {
      const { address, convertSymbol, price } = quote;
      const dbQuote: TokenQuoteTrack = await TokenQuoteTrack.findOne({where: {address, convertSymbol}});
      if(dbQuote){
        await dbQuote.update(lodash.assign(quote, { updatedAt: Date.now() }), {where: {id: dbQuote.id}});
      } else{
        await TokenQuoteTrack.add(quote);
      }

      const dbToken: Token = await Token.findOne({where: {base32: address}});
      if(dbToken){
        let totalPrice = (price && dbToken.totalSupply && Number.isInteger(dbToken.decimals))
            ? BigFixed(price).mul(dbToken.totalSupply).div(BigFixed(10).pow(dbToken.decimals)).toNumber()
            : null;
        totalPrice = totalPrice === 0 ? null : totalPrice;
        await Token.update({ price, totalPrice, updatedAt: new Date()}, {where: {id: dbToken.id}});
      }
    });
  }
}
