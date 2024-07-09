import {ScanCtx} from "../service/index";
import {Op} from "sequelize";
import {KEY_CONFURA_URL, KEY_CORE_API_URL, KEY_CORE_OPEN_API_URL, KEY_OPEN_API_URL} from "../../stat/model/KV";
import {fmtAddr} from "../../stat/StatApp";

const lodash = require('lodash');
const Big = require('big.js');
const BigFixed = require('bigfixed');
const type = require('../../common/type');
const CONST = require('../../common/const');
const parameter = require('../../common/parameter');
const checkPassword = require('../../common/middleware/checkPassword');
const cacheFlow = require('../../common/middleware/cacheFlow');
const listLimitBy = require('../../common/middleware/listLimitBy');
const durationAlarmFlow = require('../../common/middleware/durationAlarmFlow');
const arrayToCSVFlow = require('../../common/middleware/arrayToCSVFlow');
const concurrenceControl = require('../../common/middleware/concurrenceControl');
const buildFlow = require('../../common/middleware/buildFlow');
const serializeByIP = require('../../common/middleware/serializeByIP');
const { CONST: CONST_TS }  = require('../../stat/service/common/constant');
const { KV, KEY_EVM_VERSIONS } = require('../../stat/model/KV');
const {StatApp} = require("../../stat/StatApp");
const {sleepMs} = require("limit-map");
const {JsonRPCFlow} = require("../../koaflow/lib/flow/JsonRPCFlow");
export const jsonrpc = new JsonRPCFlow();

// dev stuff
jsonrpc.method('testConcurrent',
    concurrenceControl(1),
    durationAlarmFlow(1_000, { method: 'testConcurrent' }),
    async function(){
        await sleepMs(2_000)
        return {message: 'should timeout'}
    },
);

// ------------------------------- Dashboard --------------------------------

export const jsonrpc_dag = jsonrpc.method_('dag',
  parameter({
    limit: { path: '0', type: type.uint, default: 10, '<=10': (v) => v <= 10 },
  }),

  cacheFlow(1000),
  durationAlarmFlow(5 * 1000, { method: 'dag' }),
  async function () {
    const {
      app: { service },
    } = this as ScanCtx;
    const data = service.homeDashboard.getData();
    return data?.dagInfo;
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
    } = this;

    const list = await service.statistic.plot(options);
    return { total: list.length, list };
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

export const jsonrpc_frontend = jsonrpc.method_('frontend',
  cacheFlow(60 * 1000),
  durationAlarmFlow(5 * 1000, { method: 'frontend' }),
  async function () {
    const {
      app: { config, networkId, logger },
    } = this;

    let frontedConfig;
    try {
      const { frontend } = config;
      const networks = (networkId === 1029 || networkId === 1030 || networkId === 1 || networkId === 71)
        ? frontend.networks.slice(0, 4) : frontend.networks;
      const contracts = frontend.contracts.map((contract) => {
        return { key: contract.key, name: contract.name, address: contract.address[networkId] };
      });
      frontedConfig = { networkId, networks, contracts };
      const urls = await KV.findAll({where: {"key": {[Op.in]:
                      [KEY_OPEN_API_URL, KEY_CORE_OPEN_API_URL, KEY_CONFURA_URL, KEY_CORE_API_URL]
      }}})
      urls.forEach(config=>{
          frontedConfig[config.key] = config.value;
      })
    } catch (e) {
      logger.error({ src: 'frontend config error', msg: e });
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
    } = this;

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

// -------------------------------- Account ---------------------------------
jsonrpc.method('queryAccount',
  serializeByIP(),
  buildFlow((app) => parameter({
    address: { path: '0', type: app.type.address, required: true },
    fields: { path: '0', type: type([type.string]).$parse(type.arr) },
  })),

  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'queryAccount' }),
  async function (options) {
    const {
      app: { service },
    } = this;

    return service.account.query(options);
  },

  buildFlow((app) => type({
    address: app.type.simpleAddress,
    admin: app.type.simpleAddress,
  })),
);

jsonrpc.method('queryAccountBasic',
    serializeByIP(),
    buildFlow((app) => parameter({
        addressArray: { path: '0', type: type([app.type.address]).$parse(type.arr), 'length<=300': (a) => a.length <= 300 },
    })),

    cacheFlow(5 * 1000),
    concurrenceControl(500),
    durationAlarmFlow(5 * 1000, { method: 'queryAccountBasic' }),
    async function ({ addressArray }) {
        const {
            app: { service },
        } = this;

        return service.accountQuery.listPatchInfo(addressArray);
    },
);

// -------------------------------- Contract --------------------------------
jsonrpc.method('registerContract',
  serializeByIP(),
  buildFlow((app) => parameter({
    password: { path: '0', type: type.string },
    address: { path: '0', type: app.type.address, required: true },
    name: { path: '0', type: type.string },
    website: { path: '0', type: type.string }, // url
    abi: { path: '0', type: type.string }, // json
    sourceCode: { path: '0', type: type.string }, // solidity
    optimizeRuns: { path: '0', type: type.unsigned },
    icon: { path: '0', type: type.string }, // base64

    // XXX: register token for compatible old api
    token: { path: '0', type: type.object },
    'token.icon': { path: '0', type: type.string },
  })),

  checkPassword,
  concurrenceControl(500),
  durationAlarmFlow(30 * 1000, { method: 'registerContract' }),
  async function ({ address, token, ...options }) {
    const {
      app: { service },
    } = this;

    return service.contract.register({ address, ...options });
  },
);

jsonrpc.method('deregisterContract',
  serializeByIP(),
  buildFlow((app) => parameter({
    password: { path: '0', type: type.string },
    address: { path: '0', type: app.type.address, required: true },
  })),

  checkPassword,
  concurrenceControl(500),
  durationAlarmFlow(30 * 1000, { method: 'deregisterContract' }),
  async function (options) {
    const {
      app: { service },
    } = this;

    return service.contract.deregister(options);
  },
);

jsonrpc.method('queryContract',
  serializeByIP(),
  buildFlow((app) => parameter({
    address: { path: '0', type: app.type.address, required: true },
    fields: { path: '0', type: type([type.string]).$parse(type.arr), default: [] },
    detail: { path: '0', type: type.bool, default: false },
    // TODO: maxEpochNumber, announcer, announceAddress
  })),

  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'queryContract' }),
  async function ({ address, fields }) {
    const {
      app: { service },
    } = this as ScanCtx;

    const result = await service.contract.queryPlus({ address, fields });
    if (lodash.includes(fields, 'token')) {
      result.token = await service.token.queryPlus({ address });
    }

    return { ...result, isRegistered: result?.name !== undefined };
  },

  buildFlow((app) => type({
    address: app.type.simpleAddress,
    from: app.type.simpleAddress,
    admin: app.type.simpleAddress,
    token: {
      address: app.type.simpleAddress,
    },
    sponsor: {
      sponsorForCollateral: app.type.simpleAddress.$or(type.any),
      sponsorForGas: app.type.simpleAddress.$or(type.any),
    },
  })),
);

jsonrpc.method('listVersion',
  serializeByIP(),
  cacheFlow(60 * 1000),
  concurrenceControl(500),
  async function (options) {
    const {
      app: { service },
    } = this;

    const versionOriginArray = await service.contract.listVersion(options);
    const versions = lodash.mapValues(versionOriginArray, (version) => {
      const versionPartial = version.substr(8);
      return versionPartial.substr(0, versionPartial.length - 3);
    });
    return versions;
  },
);

jsonrpc.method('listLicense',
  serializeByIP(),
  cacheFlow(60 * 1000),
  concurrenceControl(500),
  async () => {
      const licenseArray =  {};
      Object.values(CONST_TS.LICENSE).forEach(value => licenseArray[value["code"]] = value["desc"]);
      return licenseArray;
  },
);

jsonrpc.method('listEVMVersion',
    serializeByIP(),
    cacheFlow(60 * 1000),
    concurrenceControl(500),
    async () => {
        const value = await KV.getString(KEY_EVM_VERSIONS, '')
        return value.split(',')
    },
);

jsonrpc.method('verifyContract',
  serializeByIP(),
  buildFlow((app) => parameter({
    address: { path: '0', type: app.type.address, required: true },
    name: { path: '0', type: type.string },
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
  concurrenceControl(500),
  async function (options) {
    const {
      app: { service },
    } = this;

    return service.contract.verify(options);
  },

  buildFlow((app) => type({
    address: app.type.simpleAddress,
  })),
);

jsonrpc.method('countAndListContract',
  serializeByIP(),
  buildFlow((app) => parameter({
    addressArray: { path: '0', type: type([app.type.address]).$parse(type.arr), 'length<=100': (a) => a.length <= 100 },
    from: { path: '0', type: app.type.address },
    minTimestamp: { path: '0', type: type.uint },
    maxTimestamp: { path: '0', type: type.uint },
    minEpochNumber: { path: '0', type: type.uint },
    maxEpochNumber: { path: '0', type: type.uint },
    limit: { path: '0', type: type.uint, default: 10, '<=100': (v) => v <= 100 },
    skip: { path: '0', type: type.uint },
    reverse: { path: '0', type: type.bool },
    fields: { path: '0', type: type([type.string]).$parse(type.arr), default: [] },
    detail: { path: '0', type: type.bool, default: false },
    // TODO: announcer, announceAddress
  })),

  listLimitBy(['from', 'minTimestamp', 'maxTimestamp', 'minEpochNumber', 'maxEpochNumber']),
  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'countAndListContract' }),
  async function ({ listLimit, ...options }) {
    const {
      app: { service },
    } = this;

    const result = await service.contract.countAndList(options);
    return { ...result, listLimit };
  },

  buildFlow((app) => type({
    list: [{
      address: app.type.simpleAddress,
    }],
  })),
);

jsonrpc.method('listContractVerified',
  serializeByIP(),
  buildFlow((app) => parameter({
    addressArray: { path: '0', type: type([app.type.address]).$parse(type.arr), 'length<=100': (a) => a.length <= 100 },
    reverse: { path: '0', type: type.bool },
    limit: { path: '0', type: type.uint, default: 10, '<=100': (v) => v <= 200 },
    skip: { path: '0', type: type.uint, default: 0 },
  })),

  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'listContractVerified' }),
  async function (options) {
    const {
      app: { service },
    } = this;
    return service.contract.listVerify(options);
  },

  buildFlow((app) => type({
    list: [{
      address: app.type.simpleAddress,
    }],
  })),
);

// jsonrpc.method('queryContractBasic',
//   serializeByIP(),
//   buildFlow((app) => parameter({
//     addressArray: { path: '0', type: type([app.type.address]).$parse(type.arr), 'length<=300': (a) => a.length <= 300 },
//   })),
//
//   cacheFlow(5 * 1000),
//   concurrenceControl(500),
//   durationAlarmFlow(5 * 1000, { method: 'queryContractBasic' }),
//   async function ({ addressArray }) {
//     const {
//       app: { service },
//     } = this;
//     return await service.contractRdb.listBasic({ addressArray });
//   },
// );

// ---------------------------------- Token ---------------------------------
jsonrpc.method('registerToken',
  serializeByIP(),
  buildFlow((app) => parameter({
    password: { path: '0', type: type.string },
    address: { path: '0', type: app.type.address, required: true },
    icon: { path: '0', type: type.string }, // base64
    marketCapId: { path: '0', type: type.integer },
    quoteUrl: { path: '0', type: type.string },
    moonDexSymbol: { path: '0', type: type.string },
    binanceSymbol: { path: '0', type: type.string },
    ipfsGateway: { path: '0', type: type.string },
  })),

  checkPassword,
  concurrenceControl(500),
  durationAlarmFlow(30 * 1000, { method: 'registerToken' }),
  async function (options) {
    const {
      app: { service },
    } = this;

    return service.token.register(options);
  },
);

jsonrpc.method('deregisterToken',
  serializeByIP(),
  buildFlow((app) => parameter({
    password: { path: '0', type: type.string },
    address: { path: '0', type: app.type.address, required: true },
  })),

  checkPassword,
  concurrenceControl(500),
  durationAlarmFlow(30 * 1000, { method: 'deregisterToken' }),
  async function (options) {
    const {
      app: { service },
    } = this;

    return service.token.deregister(options);
  },
);

jsonrpc.method('queryToken',
  serializeByIP(),
  buildFlow((app) => parameter({
    address: { path: '0', type: app.type.address, required: true },
    fields: { path: '0', type: type([type.string]).$parse(type.arr), default: [] },
    detail: { path: '0', type: type.bool, default: false },
    // TODO: maxEpochNumber, announcer, announceAddress
  })),

  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'queryToken' }),
  async function ({ address, fields }) {
    const {
      app: { service },
    } = this;

    return service.token.queryPlus({ address, fields });
  },

  buildFlow((app) => type({
    address: app.type.simpleAddress,
  })),
);

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
    // TODO: maxEpochNumber, announcer, announceAddress
  })),

  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(10 * 1000, { method: 'countAndListToken' }),
  async function (options) {
    const {
      app: { service },
    } = this;

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

jsonrpc.method('auditToken',
  serializeByIP(),
  buildFlow((app) => parameter({
    address: { path: '0', type: app.type.address, required: true },
    password: { path: '0', type: type.string },
    verify: { path: '0', type: type.bool },
    audit: { path: '0', type: type.bool },
    sponsor: { path: '0', type: type.bool },
    zeroAdmin: { path: '0', type: type.bool },
    cexBinance: { path: '0', type: type.string },
    cexHuobi: { path: '0', type: type.string },
    cexOKEx: { path: '0', type: type.string },
    dexMoonSwap: { path: '0', type: type.string },
    trackCoinMarketCap: { path: '0', type: type.string },
  })),

  checkPassword,
  concurrenceControl(500),
  durationAlarmFlow(30 * 1000, { method: 'auditToken' }),
  async function (options) {
    const {
      app: { service },
    } = this;

    return service.token.audit(options);
  },
);

// ---------------------------------- Quote -----------------------------------
jsonrpc.method('queryQuote',
  serializeByIP(),
  buildFlow((app) => parameter({
    address: { path: '0', type: app.type.address, required: true },
  })),

  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'queryQuote' }),
  () => {
    return { message: 'Deprecated' }; // service.quote.query(options);
  },
);

// ------------------------------- EventLog ---------------------------------
jsonrpc.method('listEventLogByTransactionHash',
  serializeByIP(),
  parameter({
    transactionHash: { path: '0', type: type.hex64, required: true },
    aggregate: { path: '0', type: type.bool },
  }),

  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'listEventLogByTransactionHash' }),
  async function (options) {
    const {
      app: { service },
    } = this;

    return service.eventLog.queryByTransactionHash(options);
  },
);

jsonrpc.method('queryEventLog',
  serializeByIP(),
  parameter({
    transactionHash: { path: '0', type: type.hex64, required: true },
    transactionLogIndex: { path: '0', type: type.uint, required: true },
  }),

  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'queryEventLog' }),
  async function (options) {
    const {
      app: { service },
    } = this;

    return service.eventLog.query(options);
  },
);

jsonrpc.method('countAndListEventLog',
  serializeByIP(),
  buildFlow((app) => parameter({
    address: { path: '0', type: app.type.address },
    signature: { path: '0', type: type.hex64 },
    minEpochNumber: { path: '0', type: type.uint },
    maxEpochNumber: { path: '0', type: type.uint },
    minTimestamp: { path: '0', type: type.uint },
    maxTimestamp: { path: '0', type: type.uint },
    limit: { path: '0', type: type.uint, default: 10, '<=100': (v) => v <= 100 },
    skip: { path: '0', type: type.uint, default: 0 },
    reverse: { path: '0', type: type.bool },
  })),

  listLimitBy(['address', 'signature', 'minTimestamp', 'maxTimestamp', 'minEpochNumber', 'maxEpochNumber']),
  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'countAndListEventLog' }),
  async function ({ listLimit, ...options }) {
    const {
      app: { service },
    } = this;

    const result = await service.eventLog.countAndList(options);
    return { listLimit, ...result };
  },
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

jsonrpc.method('transferTreeByTransactionHash',
  serializeByIP(),
  parameter({
    transactionHash: { path: '0', type: type.hex64 },
  }),

  cacheFlow(5 * 1000),
  concurrenceControl(500),
  durationAlarmFlow(5 * 1000, { method: 'transferTreeByTransactionHash' }),
  async function (options) {
    const {
      app: { service },
    } = this;

    return service.transfer.transferTreeByTransactionHash(options);
  },
);

// --------------------------------- ENS -----------------------------------
/*jsonrpc.method('queryENSBasic',
    serializeByIP(),
    buildFlow((app) => parameter({
        addressArray: { path: '0', type: type([app.type.address]).$parse(type.arr), 'length<=300': (a) => a.length <= 300 },
    })),

    cacheFlow(5 * 1000),
    concurrenceControl(500),
    durationAlarmFlow(5 * 1000, { method: 'queryENSBasic' }),
    async function ({ addressArray }) {
        const {
            app: { service },
        } = this;
        return service.ensCheckerQuery.nameBatch(addressArray);
    },
);*/

// --------------------------------- Export -----------------------------------
jsonrpc.method('exportTransaction',
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

    const accountBasic = await service.accountQuery.listPatchInfo([...addressSet]);
    list.forEach((each) => {
      each['From_AddressName'] = accountBasic.map[each.from]?.contract?.name || accountBasic.map[each.from]?.token?.name || '';
      each['To_AddressName'] = accountBasic.map[each.to]?.contract?.name || accountBasic.map[each.to]?.token?.name || '';
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

jsonrpc.method('exportTransfer',
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
      app: { tool, service, logger, tokenTool },
    } = this;// as ScanCtx;

    const accountBase32 = options.accountAddress !== undefined
      ? this.app.type.simpleAddress(options.accountAddress) : undefined;
    const contractBase32 = options.address !== undefined
      ? this.app.type.simpleAddress(options.address) : undefined;
    const { list } = await service.transfer.countAndList({ ...options, transferType });

    const addressSet = new Set();
    for (const each of list) {
      if (transferType === CONST.TRANSFER_TYPE.CFX) {
        each.decimals = 18;
      } else {
        const token = await tokenTool.getToken(each.address, undefined, true) || {};
        each.name = token.name;
        each.symbol = token.symbol;
        each.decimals = token.decimals || 0;
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
      addressSet.add(each.from);
      addressSet.add(each.to);
      each.address && addressSet.add(each.address);
    }

    const accountBasic = await service.accountQuery.listPatchInfo([...addressSet], {withContractInfo: true});
    list.forEach((each) => {
      each['From_AddressName'] = accountBasic.map[each.from]?.contract?.name || accountBasic.map[each.from]?.token?.name || '';
      each['To_AddressName'] = accountBasic.map[each.to]?.contract?.name || accountBasic.map[each.to]?.token?.name || '';
      if(each.address) {
          each['ContractName'] = accountBasic.map[each.address]?.contract?.name || '';
      }
    });

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
    const token = contractBase32 ? await tokenTool.getToken(contractBase32) : {};
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

