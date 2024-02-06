import {ScanApp, ScanCtx} from "./index";

const lodash = require('lodash');
const BigFixed = require("bigfixed");
const { TokenQuery } = require('../../stat/service/TokenQuery');
const { Token } = require('../../stat/model/Token');
const { KV, /*KEY_ANNOUNCE_QUERY_RDB_SWITCH,*/ SCAN_UTIL_CONTRACT } = require('../../stat/model/KV');

export class TokenService {
  app: ScanApp & any;
  private LIST_CACHE_KEY: string;
  private zip: any;
  private unzip: any;
  constructor(app) {
    this.app = app;
    this.LIST_CACHE_KEY = 'TokenService.token/list/address';

    const {
      app: { type },
    } = this;

    this.zip = type({
      icon: type.gzip,
      marketCapId: (type.uint).$after(String),
      quoteUrl: type.string,
      moonDexSymbol: type.string,
      binanceSymbol: type.string,
      ipfsGateway: type.string,
    }, { pick: true });

    this.unzip = type({
      icon: { key: type.base64ToString, value: type.unzipBase64 },
      marketCapId: { key: type.base64ToString, value: type.base64ToString.$after(Number) },
      quoteUrl: { key: type.base64ToString, value: type.base64ToString },
      moonDexSymbol: { key: type.base64ToString, value: type.base64ToString },
      binanceSymbol: { key: type.base64ToString, value: type.base64ToString },
      ipfsGateway: { key: type.base64ToString, value: type.base64ToString },
    });
  }

  async register({ address, ...rest }) {
    const {
      app: { error, dingTalk, ttlMap, service },
    } = this;

    if (!await service.conflux.isToken(address)) {
      throw new error.ParameterError(`address "${address}" is not token, register abort`);
    }

    const object = this.zip(rest);
    const array = [{ key: `token/list/${address}`, value: address }];
    lodash.forEach(object, (value, field) => {
      array.push({ key: `token/${address}/${field}`, value });
    });

    const result = await service.announce.send(array);
    ttlMap.delete(this.LIST_CACHE_KEY); // not strict drop list cache
    dingTalk.sendObject('Token register', { address, ...lodash.mapValues(object, Boolean) });
    return result;
  }

  async deregister({ address }) {
    const {
      app: { service, ttlMap, dingTalk, type },
    } = this;

    // const rdbSwitch = await KV.getSwitch(KEY_ANNOUNCE_QUERY_RDB_SWITCH);
    // if (rdbSwitch) {
      const token = await service.tokenRdb.query({ address });
      // logger.info({src: `TokenService.deregister.rdb`, msg: `${JSON.stringify(token)}`});
      if (token && type.address(token.base32) !== address) {
        return null;
      }
    // }

    const key = `token/list/${address}`;
/*    if (!rdbSwitch) {
      const { value } = await service.announce.query({ key });
      if (value !== address) {
        return null;
      }
    }*/

    const result = await service.announce.send([{ key, value: '' }]);
    ttlMap.delete(this.LIST_CACHE_KEY); // not strict drop list cache
    dingTalk.sendObject('Token deregister', { address });
    return result;
  }

  async audit({ address, ...rest }) {
    const {
      app: { error, dingTalk, service },
    } = this;

    if (!await service.conflux.isToken(address)) {
      throw new error.ParameterError(`address "${address}" is not token, audit abort`);
    }

    const result = await service.tokenRdb.audit({ address, ...rest });
    dingTalk.sendObject('Token audit', { address, rest });
    return result;
  }

  // --------------------------------------------------------------------------
  async countAndList({
    transferType,
    name,
    orderBy,
    reverse,
    skip = 0,
    limit = Infinity,
    ...options
  } = {} as any) {
    const {
      app: { tool },
    } = this;

    let list = [];
    if (options.accountAddress !== undefined) {
      tool.checkExist(options, { addressArray: false });
      list = await this._listByAccountPlus(options);
    } else if (options.addressArray !== undefined) {
      list = await this._listByAddressArrayPlus(options);
    } else {
      list = await this._listByRegisterPlus(options);
    }

    if (transferType !== undefined) {
      list = list.filter((token) => token.transferType === transferType);
    }
    if (name !== undefined) {
      const regex = new RegExp(name);
      list = list.filter((token) => regex.test(token.name));
    }

    const total = list.length;
    /*list = lodash.orderBy(list, orderBy, reverse ? 'desc' : 'asc');*/
    list =  this._sortCustomized(list);
    if (/*options.accountAddress === undefined &&*/options.addressArray === undefined) {
      list = list.slice(skip, skip + limit);
    }

    return { total, list };
  }

  // --------------------------------------------------------------------------
  _sortCustomized(tokenArray) {
    if(!tokenArray?.length) {
      return tokenArray;
    }

    const tokens = [];
    for (const token of tokenArray) {
      if(!token.transferType) continue;
      token.type = Number(token.transferType.substring(3));
      token.amount = (token.balance && Number.isInteger(token.decimals))
          ? BigFixed(token.balance).div(BigFixed(10).pow(token.decimals)).toNumber()
          : 0;
      token.marketcapHeld = (token.price && token.balance && Number.isInteger(token.decimals))
          ? BigFixed(token.price).mul(token.balance).div(BigFixed(10).pow(token.decimals)).toNumber()
          : 0;
      tokens.push(token);
    }

    const groupedTokenArray = lodash.groupBy(tokens, 'type');
    for (const type of Object.keys(groupedTokenArray)) {
      groupedTokenArray[type] = lodash.orderBy(groupedTokenArray[type], ['marketcapHeld', 'amount', 'transferCount'], ['desc', 'desc', 'desc']);
    }

    return lodash.flatten(Object.values(groupedTokenArray));
  }

  // --------------------------------------------------------------------------
  async queryPlus({ address }) {
    const {
      app: { config, service },
    } = this as ScanCtx;

    // name, symbol, decimals, granularity, totalSupply,transferType, transferCount
    const token = await service.tokenRdb.query({ address });
    return lodash.defaults({}, token);
  }

  async _listByAddressArrayPlus({ addressArray, fields } = {} as any) {
    const {
      app: { service },
    } = this;

    addressArray = [...addressArray];
    const response = await service.tokenRdb.list({ addressArray, fields: lodash.intersection(fields, ['icon']) });
    return response.list;
  }

  async _listByRegisterPlus(options) {
    const { app: {error}, } = this;
    options.orderBy = options.orderBy || 'transferCount'
    const order = {'transferCount':'transfer', 'holderCount': 'holder', price:'price'}[options.orderBy];
    if (!order) {
      throw new error.ParameterError(`Invalid order by. Only supports one of ['transferCount', 'holderCount'], got [${options.orderBy}]`)
    }
    const tokenList = await Token.findAll({
      attributes: ['base32'],
      where: {auditResult: true, portalSupport: true},
      order: [[order, options.reverse ? 'desc': 'asc']],
      skip: options.skip, limit: options.limit,
    });
    const addressArray = tokenList.map(t=>t.base32);
    // const response = await TokenQuery.listAddress({ auditResult: true, portalSupport: true });
    // const addressArray = response?.list;
    return this._listByAddressArrayPlus({ addressArray, ...options });
  }

  async _listByAccountPlus({ accountAddress, ...options }) {
    const {
      app: { service, config },
    } = this;

    const { balanceMap: dbBalanceMap, tokenArray: tokens } = await TokenQuery.listAccountTokens({ accountAddress });
    const addressArray = tokens.map((t) => t.base32);

    let utilContract = config.scanUtilContract;
    const utilInDb = await KV.getString(SCAN_UTIL_CONTRACT, '');
    if (utilInDb !== '') {
      utilContract = utilInDb;
    }
    // fetch realtime balance, but, some nft may return 0.
    const balanceArray = await service.conflux.getBalances(accountAddress, addressArray, utilContract);
    const balanceMap = {};
    addressArray.forEach((address, index) => {
      const balance = balanceArray[index] || (tokens[index].isNFT ? dbBalanceMap[tokens[index]?.hex40id]?.balance : 0);
      if (balance) balanceMap[address] = balance;
    });

    const tokenAddressArray = Object.keys(balanceMap);
    let result = [];
    if (tokenAddressArray.length) {
      // fill more token info
      const tokenArray = await this._listByAddressArrayPlus({ addressArray: tokenAddressArray, ...options });
      result = tokenArray.map((token) => {
        return { ...token, accountAddress, balance: balanceMap[token.address] };
      });
    }

    return result;
  }
}

