import {Token} from "../model/Token";
import {TokenQuote} from "../model/TokenQuote";
import {Op} from 'sequelize'
const lodash = require('lodash');
const superagent = require('superagent');
const BigFixed = require('bigfixed');

export class QuoteSync {
  protected app;

  constructor(app: any) {
    this.app = app;
  }

  public async query({ address, convertSymbol='USDT' }) {
    return await TokenQuote.findOne({where: {[Op.and]: [{address},{convertSymbol}]}});
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
      attributes: [['base32','address'], 'name', 'symbol', 'marketCapId','moonDexSymbol','binanceSymbol'],
    });
    const tokenList = rawList.map(row => row.toJSON());
    if(tokenList.length === 0) {
      return;
    }
    await this.updateFromMarketCap(tokenList).catch((e) => console.log({ src: 'updateFromMarketCap', msg: e }));
    await this.updateFromMoonDex(tokenList).catch((e) => console.log({ src: 'updateFromMoonDex', msg: e }));
    await this.updateFromBinance(tokenList).catch((e) => console.log({ src: 'updateFromBinance', msg: e }));
  }

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

  private async upsertQuote(quoteArray){
    quoteArray.map(async quote => {
      const address = quote.address;
      let convertSymbol = quote.convertSymbol;
      const dbQuote: TokenQuote = await TokenQuote.findOne({where:
        {[Op.and]: [{address},{convertSymbol}]}});
      if(dbQuote){
        const q = lodash.assign(quote, { updatedAt: Date.now() });
        await dbQuote.update(q, {where: {id: dbQuote.id}});
      } else{
        await TokenQuote.add(quote);
      }
      const dbToken: Token = await Token.findOne({where: {base32: address}});
      if(dbToken){
        const totalPrice = (quote.price && dbToken.totalSupply && Number.isInteger(dbToken.decimals))
            ? BigFixed(quote.price).mul(dbToken.totalSupply).div(BigFixed(10).pow(dbToken.decimals)).toNumber()
            : 0;
        convertSymbol = "";
        const newPrice = {[`totalPrice${convertSymbol}`]: totalPrice, [`price${convertSymbol}`]: quote.price, updatedAt: Date.now(), id: dbToken.id};
        await dbToken.update(newPrice, {where: {id: dbToken.id}});
      }
    });
  }
}
