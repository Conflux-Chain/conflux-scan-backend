import {ScanApp, ScanCtx} from "./index";

const lodash = require('lodash');
const BigFixed = require("bigfixed");
const {TokenQuery} = require('../../stat/service/TokenQuery');
const {Token} = require('../../stat/model/Token');

export class TokenService {
  app: ScanApp | any;

  constructor(app) {
    this.app = app;
  }

  // --------------------------------------------------------------------------
  async countAndList({
    accountAddress,
    addressArray,
    fields,
  } = {} as any) {
    const {
      app: { tool },
    } = this as ScanCtx;

    let list = [];
    if (accountAddress !== undefined) {
      tool.checkExist({addressArray}, { addressArray: false });
      list = await this.listByAccount(accountAddress);
      list = this.sortCustomized(list);
    } else if (addressArray !== undefined) {
      list = await this.listByAddressArray(addressArray, fields);
    } else {
      list = await this.listByRegister(fields);
    }

    return { total: list.length, list };
  }

  // --------------------------------------------------------------------------
  sortCustomized(tokens: any[]) {
    let result = [];
    if(!tokens?.length) {
      return result;
    }

    tokens.forEach((token: any) => {
      token.amount = (token.balance && Number.isInteger(token.decimals))
          ? BigFixed(token.balance).div(BigFixed(10).pow(token.decimals)).toNumber()
          : 0;
      token.marketcapHeld = (token.price && token.balance && Number.isInteger(token.decimals))
          ? BigFixed(token.price).mul(token.balance).div(BigFixed(10).pow(token.decimals)).toNumber()
          : 0;
    });

    const groupedTokens = lodash.groupBy(tokens, 'transferType');
    for (const type of Object.keys(groupedTokens)) {
      groupedTokens[type] = lodash.orderBy(groupedTokens[type],
          ['marketcapHeld', 'amount', 'totalTransfer'],
          ['desc', 'desc', 'desc']);
    }

    result = lodash.flatten(Object.values(groupedTokens));
    result.forEach(token => {
      delete token['marketcapHeld'];
      delete token['amount'];
      delete token['totalTransfer'];
    });

    return result;
  }

  // --------------------------------------------------------------------------
  async query({ address }) {
    const {
      app: { service },
    } = this as ScanCtx;

    return service.tokenQuery.query({ address });
  }

  async listByAddressArray(addressArray, fields) {
    const {
      app: { service },
    } = this as ScanCtx;

    const resp = await service.tokenQuery.list({
      addresses: [...addressArray],
      fields: lodash.intersection(fields, ['icon']),
    });

    return resp.list;
  }

  async listByRegister(fields) {
    const tokens = await Token.findAll({
      attributes: ['base32'],
      where: {auditResult: true, portalSupport: true},
    });

    if(!tokens?.length) {
      return [];
    }

    return this.listByAddressArray(tokens.map(t=>t.base32), fields);
  }

  async listByAccount(accountAddress) {
    const resp = await TokenQuery.listByAccount({
      owner: accountAddress,
      withRealtimeBalance: true
    });

    return resp.list.map((token: any) =>
      lodash.assign({
        address: token.contract,
        transferType: token.type.replace('CRC', 'ERC'), // Keep private API backward compatible
      },
      lodash.pick(token, ['balance', 'name', 'symbol', 'iconUrl', 'decimals', 'price', 'totalTransfer']))
    );
  }
}

