import {ScanCtx} from "../service/index";
import {
    CONTRACT_ANNOUNCEMENT, EVM_RPC_URL,
    KEY_CONFURA_URL,
    KEY_CORE_API_URL,
    KEY_CORE_OPEN_API_URL,
    KEY_OPEN_API_URL
} from "../../stat/model/KV";
import {fmtAddr} from "../../stat/StatApp";
import {NoCoreSpace} from "../../stat/config/StatConfig";
import {Errors} from "../../stat/service/common/LogicError";
import {CONST} from "../../stat/service/common/constant";
import {HomepageDashboard} from "../../stat/service/HomepageDashboard";
import {ApiApp} from "../app";

const lodash = require('lodash');
const Big = require('big.js');
const BigFixed = require('bigfixed');
const type = require('../../common/type');
const parameter = require('../../common/parameter');
const cacheFlow = require('../../common/middleware/cacheFlow');
const listLimitBy = require('../../common/middleware/listLimitBy');
const durationAlarmFlow = require('../../common/middleware/durationAlarmFlow');
const arrayToCSVFlow = require('../../common/middleware/arrayToCSVFlow');
const concurrenceControl = require('../../common/middleware/concurrenceControl');
const buildFlow = require('../../common/middleware/buildFlow');
const serializeByIP = require('../../common/middleware/serializeByIP');
const { KV } = require('../../stat/model/KV');
const {StatApp} = require("../../stat/StatApp");
const {JsonRPCFlow} = require("../../koaflow/lib/flow/JsonRPCFlow");
export const jsonrpc = new JsonRPCFlow();

// ------------------------------- Dashboard --------------------------------

export const jsonrpc_dag = jsonrpc.method_('dag',
  parameter({
    limit: { path: '0', type: type.uint, default: 10, '<=10': (v) => v <= 10 },
  }),

  cacheFlow(1000),
  durationAlarmFlow(5 * 1000, { method: 'dag' }),
  async function () {
    return HomepageDashboard.getData()?.dagInfo;
  },

  type({
    total: type.any,
    list: [
      [
        {
          epochNumber: type.any,
          hash: type.any,
          parentHash: type.any,
          refereeHashes: type.any,
          difficulty: type.any,
        },
      ],
    ],
  }, { pick: true }),
);

export const jsonrpc_plot = jsonrpc.method_('plot',
  parameter({
    interval: { path: '0', type: type.uint },
    limit: { path: '0', type: type.uint, default: 2, 'limit<=100': (v) => v <= 100 },
  }),

  cacheFlow(60 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'plot' }),
  async function (options) {
    const {
      app: { service },
    } = this as ScanCtx;

    return service.statistic.plot(options);
  },
);

export const jsonrpc_trend = jsonrpc.method_('trend',
  serializeByIP(),
  parameter({
    interval: { path: '0', type: type.uint, default: 60 },
  }),

  cacheFlow(60 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'trend' }),
  async function (options) {
    const {
      app: { service },
    } = this as ScanCtx;

    return service.statistic.trend(options);
  },
);
function patchDomain(host:string, netArr: {url: string}[]) {
    if (!host) {
        return netArr;
    }
    const ret = [];
    const lastSeg = host.substr(host.lastIndexOf('.'));
    for(const net of netArr) {
        let {url} = net;
        if (!url || url.endsWith(lastSeg)) {
            // nothing
        } else {
            const headingSeg = url.substring(0, url.lastIndexOf('.'));
            url = headingSeg + lastSeg;
        }
        ret.push({...net, url});
    }
    return ret;
}
export const jsonrpc_frontend = jsonrpc.method_('frontend',
  parameter({
    referer: { path: '0', type: type.string, required: false },
    host: { path: '0', type: type.string, required: false },
  }),
  cacheFlow(60 * 1000),
  durationAlarmFlow(5 * 1000, { method: 'frontend' }),
  async function ({referer, host}) {
    const {
      app: { config },
    } = this as { app: ApiApp };

    const refHost = referer || host;
    let frontedConfig;
    try {
        const frontend = CONST.FRONTEND_CONFIG;
        const networkId = StatApp.networkId;
        const productNet = networkId === 1029 || networkId === 1030 || networkId === 1 || networkId === 71;
        let networks = productNet ? frontend.networks.slice(0, 4) : (frontend.devScan[networkId] ?? []);
        try {
            if (!productNet) {
                networks = patchDomain(refHost, networks);
            }
        } catch (e) {
            console.log(`failed to patch domain`, e);
        }
        const dbAnnouncement = await KV.getString(CONTRACT_ANNOUNCEMENT, '').catch(e=>{
            console.log(`failed to load announcement`, e);
        });
      const contracts = frontend.contracts.map((contract) => {
          let useAddr = contract.address[networkId];
          if (contract.key === 'announcement' && dbAnnouncement) {
             useAddr = dbAnnouncement;
          }
          return { key: contract.key, address: useAddr };
      });
      frontedConfig = { networkId, networks, contracts, referer, host };
        if (NoCoreSpace) {
            frontedConfig.contracts = contracts.filter(c=>c.key === 'announcement');
        }
      let {from, to} = {from: '.org', to: '.net'};
      if (refHost?.includes('.org/') || refHost?.endsWith('.org') || refHost?.startsWith('http://localhost:')) {
        from = '.net'; to = '.org';
      }
      for (const kv of [KEY_OPEN_API_URL, KEY_CORE_OPEN_API_URL, KEY_CONFURA_URL, KEY_CORE_API_URL, EVM_RPC_URL]) {
          // use local config prior to shared DB config.
          frontedConfig[kv] = config[kv] ?? (CONST.CHAIN_INFO[StatApp.networkId] || {})[kv] ?? await KV.getString(kv);
          if (refHost && frontedConfig[kv]) {
            frontedConfig[kv] = frontedConfig[kv].replace(from, to);
          }
      }
    } catch (e) {
        console.log('frontend config error', e);
    }

    return frontedConfig;
  },
);

// --------------------------------- Block ----------------------------------
export const jsonrpc_queryBlock = jsonrpc.method_('queryBlock',
  parameter({
    hash: { path: '0', type: type.string, required: true },
    fields: { path: '0', type: type([type.string]).$parse(type.arr) },
  }),

  cacheFlow(5 * 1000),
  durationAlarmFlow(5 * 1000, { method: 'queryBlock' }),
  async function (options) {
    const { app: { service }, } = this as ScanCtx;
    return service.block.query(options);
  },

  buildFlow((app) => type({
    miner: app.type.simpleAddress,
    transactions: () => undefined,
  }).$or(null)),
);

export const jsonrpc_listBlock = jsonrpc.method_('countAndListBlock',
  buildFlow((app) => parameter({
    epochNumber: { path: '0', type: type.uint },
    blockHash: { path: '0', type: type.hex64 },
    minTimestamp: { path: '0', type: type.uint },
    maxTimestamp: { path: '0', type: type.uint },
    miner: { path: '0', type: app.type.address },

    referredBy: { path: '0', type: type.hex64 },
    minEpochNumber: { path: '0', type: type.uint },
    maxEpochNumber: { path: '0', type: type.uint },
    limit: { path: '0', type: type.uint, default: 10, '<=100': (v) => v <= 100 },
    skip: { path: '0', type: type.uint, default: 0 },
    reverse: { path: '0', type: type.bool },
    fields: { path: '0', type: type([type.string]).$parse(type.arr) },
  })),

  listLimitBy(['miner', 'minTimestamp', 'maxTimestamp', 'minEpochNumber', 'maxEpochNumber']),
  cacheFlow(5 * 1000),
  durationAlarmFlow(5 * 1000, { level: 'warning', method: 'countAndListBlock' }),
  async function ({ listLimit, ...options }) {
    const { app: { service }, } = this as ScanCtx;

    const result = await service.block.countAndList(options);
    return { ...result, listLimit };
  },

  type({
    list: [{
      transactions: () => undefined,
    }],
  }),
);

// ------------------------------- Transaction ------------------------------
export const jsonrpc_queryTransaction = jsonrpc.method_('queryTransaction',
  serializeByIP(),
  parameter({
    hash: { path: '0', type: type.hex64, required: true },
    fields: { path: '0', type: type([type.string]).$parse(type.arr) },
    aggregate: { path: '0', type: type.bool },
  }),

  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'queryTransaction' }),
  async function (options) {
    const {
      app: { service },
    } = this as ScanCtx;

    return service.transaction.query(options).then(res=>{
        if (res?.from) {
            res.from = fmtAddr(res.from, StatApp.networkId)
        }
        if (res?.to) {
            res.to = fmtAddr(res.to, StatApp.networkId)
        }
        return res;
    });
  },

  type({
    logs: () => undefined,
    logsBloom: () => undefined,
  }).$or(null),
);

export const jsonrpc_countAndListTransaction = jsonrpc.method_('countAndListTransaction',
  buildFlow((app) => parameter({
    blockHash: { path: '0', type: type.hex64 },
    accountAddress: { path: '0', type: app.type.address },

    minTimestamp: { path: '0', type: type.uint },
    maxTimestamp: { path: '0', type: type.uint },
    from: { path: '0', type: app.type.address }, // new add
    to: { path: '0', type: app.type.address }, // new add
    transactionHash: { path: '0', type: type.hex64 }, // new add
    txType: { path: '0', type: type.string, enum: Object.values(CONST.TX_TYPE) },
    status: { path: '0', type: type.uint, enum: [CONST.TX_STATUS.FAILED] },

    minEpochNumber: { path: '0', type: type.uint },
    maxEpochNumber: { path: '0', type: type.uint },
    nonce: { path: '0', type: type.uint },
    limit: { path: '0', type: type.uint, default: 10, '<=100': (v) => v <= 100 },
    skip: { path: '0', type: type.uint, default: 0 },
    reverse: { path: '0', type: type.bool },
    fields: { path: '0', type: type([type.string]).$parse(type.arr) },
  })),

  listLimitBy(['accountAddress', 'minTimestamp', 'maxTimestamp', 'minEpochNumber', 'maxEpochNumber']),
  cacheFlow(5 * 1000),
  durationAlarmFlow(5 * 1000, { level: 'warning', method: 'countAndListTransaction' }),
  async function ({ listLimit, ...options }) {
    const {
      app: { service },
    } = this as ScanCtx;

    const result = await service.transaction.countAndList(options);
    return { ...result, listLimit };
  },

  type({
    list: [{
      data: () => undefined,
      logs: () => undefined,
      logsBloom: () => undefined,
    }],
  }),
);

// -------------------------------- Contract --------------------------------
export const jsonrpc_queryContract = jsonrpc.method_('queryContract',
  serializeByIP(),
  buildFlow((app) => parameter({
    address: { path: '0', type: app.type.address, required: true },
    fields: { path: '0', type: type([type.string]).$parse(type.arr), default: [] },
    detail: { path: '0', type: type.bool, default: false },
  })),

  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'queryContract' }),
  async function ({ address, fields }) {
    const {
      app: { service },
    } = this as ScanCtx;

    const result = await service.contract.query({ address, fields });
    if (lodash.includes(fields, 'token')) {
      result.token = await service.tokenQuery.query({ address });
    }
    return { ...result, isRegistered: result?.name !== undefined };
  },

  buildFlow((app) => type({
    address: app.type.simpleAddress,
    from: app.type.simpleAddress.$or(type.any),
    admin: app.type.simpleAddress,
    sponsor: {
      sponsorForCollateral: app.type.simpleAddress.$or(type.any),
      sponsorForGas: app.type.simpleAddress.$or(type.any),
    },
  })),
);

export const jsonrpc_listCompilers = jsonrpc.method_('listCompilers',
  cacheFlow(60 * 1000),
  async function () {
      const {
          app: { service },
      } = this as ScanCtx

      return await service.contractQuery.listSolcVersions()
  },
);

export const jsonrpc_listVyperCompilers = jsonrpc.method_('listVyperCompilers',
    cacheFlow(60 * 1000),
    async function () {
        const {
            app: { service },
        } = this as ScanCtx

        const versions = await service.contractQuery.listVyperVersions()
        return lodash.mapValues(versions, v => v.desc)
    },
);

export const jsonrpc_verifyContract = jsonrpc.method_('verifyContract',
  serializeByIP(),
  buildFlow((app) => parameter({
    address: { path: '0', type: app.type.address, required: true },
    name: { path: '0', type: type.string },
    codeFormat: { path: '0', type: type.string },
    sourceCode: { path: '0', type: type.string },
    compiler: { path: '0', type: type.string },
    optimizeRuns: { path: '0', type: type.unsigned },
    license: { path: '0', type: type.string },
    constructorArgs: { path: '0', type: type.string },
    libraryName1: { path: '0', type: type.string },
    libraryAddress1: { path: '0', type: app.type.address },
    libraryName2: { path: '0', type: type.string },
    libraryAddress2: { path: '0', type: app.type.address },
    libraryName3: { path: '0', type: type.string },
    libraryAddress3: { path: '0', type: app.type.address },
    libraryName4: { path: '0', type: type.string },
    libraryAddress4: { path: '0', type: app.type.address },
    libraryName5: { path: '0', type: type.string },
    libraryAddress5: { path: '0', type: app.type.address },
    libraryName6: { path: '0', type: type.string },
    libraryAddress6: { path: '0', type: app.type.address },
    libraryName7: { path: '0', type: type.string },
    libraryAddress7: { path: '0', type: app.type.address },
    libraryName8: { path: '0', type: type.string },
    libraryAddress8: { path: '0', type: app.type.address },
    libraryName9: { path: '0', type: type.string },
    libraryAddress9: { path: '0', type: app.type.address },
    libraryName10: { path: '0', type: type.string },
    libraryAddress10: { path: '0', type: app.type.address },
    evmVersion: { path: '0', type: app.type.string },
  })),

  cacheFlow(5 * 1000),
  async function (options) {
    const {
      app: { service },
    } = this as ScanCtx;

    return service.contract.verifySourcecode(options)
  },

  buildFlow((app) => type({
    address: app.type.simpleAddress,
  })),
);

export const jsonrpc_verifyCrossSpace = jsonrpc.method_('verifyCrossChain',
    serializeByIP(),
    buildFlow((app) => parameter({
        address: { path: '0', type: app.type.address, required: true },
        includeAllOtherSpace: { path: '0', type: type.bool },
    })),

    cacheFlow(5 * 1000),
    async function (options) {
        const {
            app: { service },
        } = this as ScanCtx;
        return service.contract.verifyCrossSpace(options);
    },

    buildFlow((app) => type({
        address: app.type.simpleAddress,
    })),
);

export const jsonrpc_countAndListContract = jsonrpc.method_('countAndListContract',
  serializeByIP(),
  buildFlow((app) => parameter({
    addressArray: { path: '0', type: type([app.type.address]).$parse(type.arr), 'length<=100': (a) => a.length <= 100 },
  })),

  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'countAndListContract' }),
  async function ({ listLimit, ...options }) {
    const {
      app: { service },
    } = this as ScanCtx;

    const list = await service.contract.listByAddresses(options as any);
    return { total: list?.length || 0, list, listLimit };
  },

  buildFlow((app) => type({
    list: [{
      address: app.type.simpleAddress,
      admin: app.type.simpleAddress,
    }],
  })),
);

// ---------------------------------- Token ---------------------------------
export const jsonrpc_countAndListToken = jsonrpc.method_('countAndListToken',
  serializeByIP(),
  buildFlow((app) => parameter({
    transferType: { path: '0', type: type.string, enum: Object.values(CONST.TRANSFER_TYPE) },
    addressArray: { path: '0', type: type([app.type.address]).$parse(type.arr), 'length<=100': (a) => a.length <= 100 },
    accountAddress: { path: '0', type: app.type.address },
    name: { path: '0', type: type.string },
    orderBy: { path: '0', type: type.string },
    limit: { path: '0', type: type.uint, default: 10, '<=100': (v) => v <= 100 },
    skip: { path: '0', type: type.uint },
    reverse: { path: '0', type: type.bool },
    fields: { path: '0', type: type([type.string]).$parse(type.arr), default: [] },
    detail: { path: '0', type: type.bool },
  })),

  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(10 * 1000, { method: 'countAndListToken' }),
  async function (options) {
    const {
      app: { service },
    } = this as ScanCtx;
    if (options.addressArray?.length > 100) {
        throw new Errors.ParameterError(`invalid length of address array, ${options.addressArray.length} > 100`);
    }

    return service.token.countAndList(options);
  },

  buildFlow((app) => type({
    list: [
      {
        address: app.type.simpleAddress,
        accountAddress: app.type.simpleAddress, // XXX: for user token list
      },
    ],
  })),
);

// ------------------------------- Transfer -----------------------------------
export const jsonrpc_countAndListTransfer = jsonrpc.method_('countAndListTransfer',
  serializeByIP(),
  buildFlow((app) => parameter({
    transactionHash: { path: '0', type: type.hex64 },
    transferType: { path: '0', type: type.string, required: (o) => !o.transactionHash, enum: Object.values(CONST.TRANSFER_TYPE) },
    accountAddress: { path: '0', type: app.type.address },
    address: { path: '0', type: app.type.address },
    minTimestamp: { path: '0', type: type.uint },
    maxTimestamp: { path: '0', type: type.uint },
    from: { path: '0', type: app.type.address }, // new add
    to: { path: '0', type: app.type.address }, // new add
    tokenId: { path: '0', type: type.bigInt },
    txType: { path: '0', type: type.string, enum: Object.values(CONST.TX_TYPE) }, // new add
    status: { path: '0', type: type.uint, enum: [CONST.TX_STATUS.FAILED] }, // new add
    zeroValue: { path: '0', type: type.bool },
    tokenArray: { path: '0', type: type([app.type.address]).$parse(type.arr), 'length<=3': (a) => a.length <= 3 },

    minEpochNumber: { path: '0', type: type.uint },
    maxEpochNumber: { path: '0', type: type.uint },
    limit: { path: '0', type: type.uint, default: 10, '<=100': (v) => v <= 100 },
    skip: { path: '0', type: type.uint, default: 0 },
    reverse: { path: '0', type: type.bool },
    fields: { path: '0', type: type([type.string]).$parse(type.arr), default: [] },

    // casFilter: { path: '0', type: type.bool }, // new add
  })),

  listLimitBy(['address', 'accountAddress', 'tokenId', 'minTimestamp', 'maxTimestamp', 'minEpochNumber', 'maxEpochNumber']),
  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { level: 'warning', method: 'countAndListTransfer' }),
  async function ({ listLimit, ...options }) {
    const {
      app: { service },
    } = this as ScanCtx;

    const result = await service.transfer.countAndList(options);
    result?.list.forEach(item => {
        delete item.transactionIndex;
        delete item.logIndex;
        delete item.blockIndex;
        delete item.txIndex;
        delete item.txLogIndex;
        delete item.topics;
        delete item.data;
        delete item.blockHash;
        delete item.space;
    });
    return { ...result, listLimit };
  },

  buildFlow((app) => type({
    list: [{
      address: app.type.simpleAddress,
      from: app.type.simpleAddress.$or(type.any),
      to: app.type.simpleAddress.$or(type.any),
      operator: app.type.simpleAddress.$or(type.any),
    }],
  })),
);

// --------------------------------- ENS -----------------------------------

// --------------------------------- Export -----------------------------------
export const jsonrpc_exportTransaction = jsonrpc.method_('exportTransaction',
  serializeByIP(),
  buildFlow((app) => parameter({
    accountAddress: { path: '0', type: app.type.address },
    txType: { path: '0', type: type.string, enum: Object.values(CONST.TX_TYPE) },
    status: { path: '0', type: type.uint, enum: [CONST.TX_STATUS.FAILED] },
    minTimestamp: { path: '0', type: type.uint },
    maxTimestamp: { path: '0', type: type.uint },
    minEpochNumber: { path: '0', type: type.uint },
    maxEpochNumber: { path: '0', type: type.uint },
    limit: { path: '0', type: type.uint, default: 10, '<=10000': (v) => v <= 10000 },
    skip: { path: '0', type: type.uint, default: 0 },
    reverse: { path: '0', type: type.bool },

    blockHash: { path: '0', type: type.hex64 },
    transactionHash: { path: '0', type: type.hex64 }, // new add
    nonce: { path: '0', type: type.uint }, // new add
    from: { path: '0', type: app.type.address }, // new add
    to: { path: '0', type: app.type.address }, // new add
    token: { path: '0', type: type.string },
  })),
  concurrenceControl(500),
  durationAlarmFlow(120 * 1000, { method: 'exportTransaction' }),

  async function (options) {
    const {
      app: { service, tool },
    } = this as ScanCtx;

    const accountBase32 = options.accountAddress !== undefined
      ? this.app.type.simpleAddress(options.accountAddress) : undefined;
    const { list } = await service.transaction.countAndList(options);

    const addressSet = new Set();
    list.forEach((each) => {
      each['Value(CFX)'] = Big(each.value).div(1e18).toString();
      if (accountBase32 && each.from === accountBase32) {
        each['Value_Out(CFX)'] = each['Value(CFX)'];
      }
      if (accountBase32 && each.to === accountBase32) {
        each['Value_In(CFX)'] = each['Value(CFX)'];
      }
      each['GasPrice(CFX)'] = Big(each.gasPrice).div(1e18).toString();
      each['GasFee(CFX)'] = Big(each.gasFee).div(1e18).toString();
      each['Status'] = each.status === 0 ? 'success' : 'fail';
      each['Method'] = each.method === '0x' ? '' : each.method;
      each['DateTime'] = tool.timestampToString(each.timestamp * 1000);
      addressSet.add(each.from);
      addressSet.add(each.to);
    });

    const nameMap = await service.accountQuery.list([...addressSet] as string[], {withContractInfo: true});
    list.forEach((each) => {
      each['From_AddressName'] = nameMap[each.from]?.token?.name || nameMap[each.from]?.contract?.name || '';
      each['To_AddressName'] = nameMap[each.to]?.token?.name || nameMap[each.to]?.contract?.name || '';
    });

    const exportFields = [
          ['timestamp', 'UnixTimestamp'],
          ['epochNumber', 'EpochNumber'],
          ['hash', 'TxHash'],
          ['from', 'From'],
          'From_AddressName',
          ['to', 'To'],
          'To_AddressName',
          ['contractCreated', 'ContractCreated'],
          'Value(CFX)',
          'Value_In(CFX)',
          'Value_Out(CFX)',
          'GasPrice(CFX)',
          'GasFee(CFX)',
          'Status',
          'Method',
          'DateTime',
      ];
    return {address: accountBase32, list, exportFields};
  },

  buildFlow((app) => type({
      list: [
          {
            from: StatApp.isEVM ? app.type.address.$after((v) => `${v}`).$or(type.any) : app.type.simpleAddress.$after((v) => `${v}`).$or(type.any),
            to: StatApp.isEVM ? app.type.address.$after((v) => `${v}`).$or(type.any) : app.type.simpleAddress.$after((v) => `${v}`).$or(type.any),
            contractCreated: StatApp.isEVM ? app.type.address.$after((v) => `${v}`).$or(type.any) : app.type.simpleAddress.$after((v) => `${v}`).$or(type.any),
          },
      ],
  })),
  arrayToCSVFlow(),
);

export const jsonrpc_exportTransfer = jsonrpc.method_('exportTransfer',
  serializeByIP(),
  buildFlow((app) => parameter({
    transactionHash: { path: '0', type: type.hex64 },
    transferType: { path: '0', type: type.string, enum: Object.values(CONST.TRANSFER_TYPE) },
    accountAddress: { path: '0', type: app.type.address },
    address: { path: '0', type: app.type.address },
    minTimestamp: { path: '0', type: type.uint },
    maxTimestamp: { path: '0', type: type.uint },
    from: { path: '0', type: app.type.address }, // new add
    to: { path: '0', type: app.type.address }, // new add

    tokenId: { path: '0', type: type.bigInt },
    txType: { path: '0', type: type.string, enum: Object.values(CONST.TX_TYPE) }, // new add
    status: { path: '0', type: type.uint, enum: [CONST.TX_STATUS.FAILED] }, // new add
    zeroValue: { path: '0', type: type.bool },
    tokenArray: { path: '0', type: type([app.type.address]).$parse(type.arr), 'length<=3': (a) => a.length <= 3 }, // new add

    minEpochNumber: { path: '0', type: type.uint },
    maxEpochNumber: { path: '0', type: type.uint },
    limit: { path: '0', type: type.uint, default: 10, '<=10000': (v) => v <= 10000 },
    skip: { path: '0', type: type.uint, default: 0 },
    reverse: { path: '0', type: type.bool },
    token: { path: '0', type: type.string },
  })),
  concurrenceControl(500),
  durationAlarmFlow(120 * 1000, { method: 'exportTransfer' }),

  async function ({ transferType, ...options }) {
    const {
      app: { tool, service, tokenTool },
    } = this as ScanCtx;

    const accountBase32 = options.accountAddress !== undefined
      ? this.app.type.simpleAddress(options.accountAddress) : undefined;
    const contractBase32 = options.address !== undefined
      ? this.app.type.simpleAddress(options.address) : undefined;
    const { list } = await service.transfer.countAndList({ ...options, transferType });

    const addresses = new Set(list.flatMap(item => [item.from, item.to, item.address]).filter(Boolean));
    const nameMap = await service.accountQuery.list([...addresses] as string[], {withContractInfo: true});

    for (const each of list) {
      if (transferType === CONST.TRANSFER_TYPE.CFX) {
        each.decimals = 18;
      } else {
        const token = nameMap[each.address]?.token;
        each.name = token?.name;
        each.symbol = token?.symbol;
        each.decimals = token?.decimals || 0;
      }
      if (transferType === CONST.TRANSFER_TYPE.ERC721) {
        each.value = 1;
        each['Value'] = 1;
      } else {
        each['Value'] = BigFixed(each.value).div(BigFixed(10).pow(each.decimals)).toString();
      }
      if (accountBase32 && each.from === accountBase32) {
        each['Value_Out'] = each['Value'];
      }
      if (accountBase32 && each.to === accountBase32) {
        each['Value_In'] = each['Value'];
      }
      each['Type'] = transferType;
      each['DateTime'] = tool.timestampToString(each.timestamp * 1000);
      each['TokenId'] = each['tokenId'] ? `\t${each['tokenId']}` : each['tokenId'];
      each['From_AddressName'] = nameMap[each.from]?.token?.name || nameMap[each.from]?.contract?.name || '';
      each['To_AddressName'] = nameMap[each.to]?.token?.name || nameMap[each.to]?.contract?.name || '';
      if(each.address) {
        each['ContractName'] = nameMap[each.address]?.contract?.name || '';
      }
    }

    const exportFields = [
          ['timestamp', 'UnixTimestamp'],
          ['epochNumber', 'EpochNumber'],
          ['transactionHash', 'TxHash'],
          ['transactionLogIndex', 'TxLogIndex'],
          ['from', 'From'],
          'From_AddressName',
          ['to', 'To'],
          'To_AddressName',
      ];
      if (transferType === CONST.TRANSFER_TYPE.CFX) {
          exportFields.push(...[
              ['Value', 'Value(CFX)'],
              ['Value_In', 'Value_In(CFX)'],
              ['Value_Out', 'Value_Out(CFX)'],
              'DateTime',
          ])
      }
      if (transferType === CONST.TRANSFER_TYPE.ERC20) {
          if (accountBase32) {
              exportFields.push(...[
                  ['address', 'ContractAddress'],
                  'ContractName',
                  ['name', 'TokenName'],
                  ['symbol', 'TokenSymbol'],
                  ['decimals', 'Decimals'],
              ])
          }
          exportFields.push(...[
              ['Value', 'Quantity'],
              'DateTime',
          ])
      }
      if (transferType === CONST.TRANSFER_TYPE.ERC721 || transferType === CONST.TRANSFER_TYPE.ERC1155) {
          if (accountBase32) {
              exportFields.push(...[
                  ['address', 'ContractAddress'],
                  'ContractName',
                  ['name', 'TokenName'],
                  ['symbol', 'TokenSymbol'],
              ])
          }
          exportFields.push(...[
              'TokenId',
              ['Value', 'Quantity'],
              'Type',
              'DateTime',
          ])
      }
    const token = contractBase32 ? await tokenTool.getToken(contractBase32) : null;
    return {address: accountBase32, contract: contractBase32, tokeSymbol: token?.symbol, transferType, list, exportFields};
  },

  buildFlow((app) => type({
      list: [
          {
            address: StatApp.isEVM ? app.type.address.$after((v) => `${v}`).$or(type.any) : app.type.simpleAddress.$after((v) => `${v}`).$or(type.any),
            from: StatApp.isEVM ? app.type.address.$after((v) => `${v}`).$or(type.any) : app.type.simpleAddress.$after((v) => `${v}`).$or(type.any),
            to: StatApp.isEVM ? app.type.address.$after((v) => `${v}`).$or(type.any) : app.type.simpleAddress.$after((v) => `${v}`).$or(type.any),
          },
      ],
  })),
  arrayToCSVFlow(),
);

