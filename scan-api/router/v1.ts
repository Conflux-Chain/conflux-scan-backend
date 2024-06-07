import {ScanCtx} from "../service/index";

const lodash = require('lodash');
const {Router} = require('../../koaflow/src/router');
const {OpenAPI} = require('../../koaflow/lib/OpenAPI');
const CONST = require('../../common/const');
const error = require('../../common/error');
const {StatApp} = require("../../stat/StatApp");
const { buildCheckAddressRateFn } = require('../../stat/router/RateLimiter')
const moment = require("moment/moment");
const {patchFlowError} = require("../../koaflow/lib/flow/JsonRPCFlow");
const myFlow = require("./MyApiFlow");
const {jsonrpc} = require("./jsonrpc");
const openAPI = new OpenAPI({
  info: {
    version: 'v1.0.0',
    title: 'conflux-scan',
    description: `
## ErrorCode:
code | name | status
-----|------|--------
${lodash.filter(error, (E) => E.code).map((E) => `${E.code} | ${E.name} | ${E.status}`).join('\n')}
`,
  },
  servers: [
    {
      url: 'http://scan-dev-service.conflux-chain.org:8895/v1',
      description: 'DEV-NET',
    },
    {
      url: 'https://testnet.confluxscan.io/v1',
      description: 'TEST-NET',
    },
    {
      url: 'https://testnet-scantest.confluxnetwork.org/v1',
      description: 'TEST-NET(staging)',
    },
    {
      url: 'https://confluxscan.io/v1',
      description: 'MAIN-NET',
    },
    {
      url: 'https://scantest.confluxnetwork.org/v1',
      description: 'MAIN-NET(staging)',
    },
  ],
});

OpenAPI.flow = myFlow;
// ----------------------------------------------------------------------------
const router = new Router();
router.use(async (ctx, next) => {
  const {
    app: { dingTalk },
  } = ctx;

  ctx.set('Access-Control-Allow-Origin', '*'); // for "swagger.io"
  try {
    await next();
    if(ctx.type === 'application/octet-stream') return;
    patchFlowError(ctx);
    if(ctx.body?.code){
      throw lodash.assign(new Error(), {status: ctx.status}, lodash.pick(ctx.body, ['code', 'message']));
    }
    ctx.body = StatApp.isEVM ? { status: '1', message: '', result: ctx.body } :
        { code: 0, message: '', data: ctx.body };
  } catch (e) {
    if(e.code === undefined){
      e = new error.BizError(e.message);
    }
    // see common/error.js
    ctx.status = e.status;
    ctx.body = StatApp.isEVM ? { status: `${e.code}`, message: e.message, result: e.partialData } :
        { code: e.code, message: e.message, data: e.partialData };
  }
});
router.get('/', function (ctx) {
  const { app: { config: { machine } } } = this;
  ctx.body = { message: `scan backend, [${machine}]` };
});
router.get('/testDing', async function(ctx){
  const { app: { dingTalk } } = ctx;
  ctx.body = await dingTalk.sendObject(`test-ding`, {header: ctx.headers})
});
router.get('/testConcurrent', jsonrpc.methodFlow('testConcurrent'));
// --------------------------------- OpenAPI ----------------------------------
router.get('/openAPI', () => openAPI.toObject());

// -------------------------------- Statistic ---------------------------------
router.get('/supply',
  OpenAPI.flow({
    tags: ['statistic'],
    input: {},
    output: {
      200: {
        totalCirculating: 'string',
        totalCollateral: 'string',
        totalIssued: 'string',
        totalStaking: 'string',
        nullAddressBalance: 'string',
        twoYearUnlockBalance: 'string',
        fourYearUnlockBalance: 'string',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('supply'),
);

router.get('/dag',
  OpenAPI.flow({
    tags: ['statistic'],
    input: {
      limit: { in: 'query', type: 'integer', minimum: 0, maximum: 10, default: 10 },
    },
    output: {
      200: {
        total: 'integer',
        list: [
          [
            {
              epochNumber: 'integer',
              hash: 'string',
              parentHash: 'string',
              refereeHashes: ['string'],
              difficulty: 'string',
            },
          ],
        ],
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('dag'),
);

router.get('/plot',
  OpenAPI.flow({
    tags: ['statistic'],
    input: {
      interval: { in: 'query', type: 'integer', description: 'interval in seconds' },
      limit: { in: 'query', type: 'integer', minimum: 0, maximum: 100, default: 2 },
    },
    output: {
      200: {
        total: 'integer',
        list: [
          {
            timestamp: 'string',
            tps: 'string',
            difficulty: 'string',
            blockTime: 'string',
            hashRate: 'string',
          },
        ],
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('plot'),
);

router.get('/trend',
  OpenAPI.flow({
    tags: ['statistic'],
    input: {
      interval: { in: 'query', type: 'integer', description: 'interval in seconds' },
    },
    output: {
      200: {
        tps: { value: 'string', trend: 'string' },
        difficulty: { value: 'string', trend: 'string' },
        blockTime: { value: 'string', trend: 'string' },
        hashRate: { value: 'string', trend: 'string' },
        transactionGasPrice: { value: 'string', trend: 'string' },
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('trend'),
);

router.get('/homeDashboard',
  OpenAPI.flow({
    tags: ['statistic'],
    input: {},
    output: {
      200: {
        epochNumber: 'integer',
        blockNumber: 'integer',
        addressCount: 'integer',
        transactionCount: 'integer',
        contractCount: 'integer',
        gasUsedPerSecond: 'integer',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('homeDashboard'),
);

router.get('/frontend',
  OpenAPI.flow({
    tags: ['frontend'],
    input: {},
    output: {
      200: 'object',
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('frontend'),

  async function (result) {
    const addressArray = result.contracts.filter(item => item.address).map(item => item.address);
    const accountBasic = await jsonrpc.methodFlow('queryAccountBasic').call(this, { addressArray });
    result.contracts.forEach((item) => {
      item.ensInfo = accountBasic.map[item.address]?.ens;
      item.nameTagInfo = accountBasic.map[item.address]?.nameTag;
    });
    return result;
  },
);

// --------------------------------- Block ----------------------------------
router.get('/block/:hash',
  OpenAPI.flow({
    tags: ['block'],
    input: {
      hash: { in: 'path', type: 'string', required: true }, // block hash or block height
      fields: {
        in: 'query', type: 'array', default: ['avgGasPrice', 'pivotHash', 'risk', 'totalReward'],
        items: { type: 'string', enum: ['newTransactionCount', 'avgGasPrice', 'blockIndex', 'pivotHash', 'risk', 'baseReward', 'totalReward', 'txFee'] },
      },
    },
    output: {
      200: {
        epochNumber: 'integer',
        blame: 'integer',
        height: 'integer',
        size: 'integer',
        timestamp: 'integer',
        gasLimit: 'string',
        difficulty: 'string',
        adaptive: 'boolean',
        hash: 'string',
        miner: 'string',
        nonce: 'string',
        parentHash: 'string',
        powQuality: 'string',
        refereeHashes: ['string'],
        posReference: 'string',
        transactionsRoot: 'string',
        gasUsed: 'string',
        transactionCount: 'integer',
        crossSpaceTransactionCount: 'integer',
        newTransactionCount: 'integer',
        avgGasPrice: 'string',
        blockIndex: 'integer',
        pivotHash: 'string',
        syncTimestamp: 'integer',
        risk: 'number',
        baseReward: 'string',
        totalReward: 'string',
        txFee: 'string',
        baseFeePerGas: 'integer',
        baseFeePerGasRef: 'object',
        burntGasFee: 'integer',
        rewardDetail: 'object',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('queryBlock'),
  (block) => block || {}, // XXX: null => {}, cause http json can not handle null good
);

router.get('/block',
  OpenAPI.flow({
    tags: ['block'],
    input: {
      epochNumber: { in: 'query', type: 'integer', minimum: 0, description: 'use alone' },
      blockHash: { in: 'query', type: 'string', description: 'use alone' },
      minTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      maxTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      miner: { in: 'query', type: 'string' },

      referredBy: { in: 'query', type: 'string', description: 'use alone' },
      minEpochNumber: { in: 'query', type: 'integer', minimum: 0 },
      maxEpochNumber: { in: 'query', type: 'integer', minimum: 0 },
      reverse: { in: 'query', type: 'boolean', default: true }, // XXX: front-end is lazy to input 'true'
      skip: { in: 'query', type: 'integer', minimum: 0, default: 0 },
      limit: { in: 'query', type: 'integer', minimum: 0, maximum: 100, default: 10 },
      fields: {
        in: 'query', type: 'array', default: ['avgGasPrice', 'pivotHash', 'risk', 'totalReward'],
        items: { type: 'string', enum: ['newTransactionCount', 'avgGasPrice', 'blockIndex', 'pivotHash', 'risk', 'baseReward', 'totalReward', 'txFee'] },
      },
    },
    output: {
      200: {
        total: 'integer',
        listLimit: OpenAPI.schema({ type: 'integer', description: 'if exist, require skip+limit <= listLimit' }),
        list: [
          {
            epochNumber: 'integer',
            hash: 'string',
            miner: 'string',
            gasLimit: 'string',
            difficulty: 'string',
            timestamp: 'integer',
            transactionCount: 'integer',
            executedTransactionCount: 'integer',
            crossSpaceTransactionCount: 'integer',
            avgGasPrice: 'string',
            blockIndex: 'integer',
            pivotHash: 'string',
            syncTimestamp: 'integer',
            gasUsed: 'string',
            totalReward: 'string',
            minerContractInfo: 'object',
            minerTokenInfo: 'object',
            minerENSInfo: 'object',
            minerNameTagInfo: 'object',
            coreBlock: 'boolean',
            burntGasFee: 'integer',
          },
        ],
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('countAndListBlock'),

  async function (result) {
    let addressArray = [];
    result.list.forEach((block) => {
      addressArray.push(block.miner.toString());
    });
    const accountBasic = await jsonrpc.methodFlow('queryAccountBasic').call(this, { addressArray });
    result.list.forEach((block) => {
      block.minerContractInfo = accountBasic.map[block.miner]?.contract;
      block.minerTokenInfo = accountBasic.map[block.miner]?.token;
      block.minerENSInfo = accountBasic.map[block.miner]?.ens;
      block.minerNameTagInfo = accountBasic.map[block.miner]?.nameTag;
    });
    return result;
  },
);

// ------------------------------- Transaction ------------------------------
router.get('/transaction/:hash',
  OpenAPI.flow({
    tags: ['transaction'],
    input: {
      hash: { in: 'path', type: 'string', required: true },
      fields: {
        in: 'query', type: 'array', default: ['risk', 'gasFee'],
        items: { type: 'string', enum: ['risk', 'gasCoveredBySponsor', 'gasFee', 'gasUsed', 'stateRoot', 'storageCollateralized', 'storageCoveredBySponsor', 'storageReleased', 'txExecErrorMsg'] },
      },
      aggregate: { in: 'query', type: 'boolean', default: false },
    },
    output: {
      200: {
        nonce: 'string',
        value: 'string',
        gasPrice: 'string',
        gas: 'string',
        v: 'integer',
        transactionIndex: 'integer',
        status: 'integer',
        storageLimit: 'string',
        chainId: 'integer',
        epochHeight: 'integer',
        blockHash: 'string',
        method: 'string',
        contractCreated: OpenAPI.schema({ type: 'string', nullable: true }),
        data: 'string',
        from: 'string',
        hash: 'string',
        r: 'string',
        s: 'string',
        to: OpenAPI.schema({ type: 'string', nullable: true }),
        epochNumber: 'integer',
        risk: 'number',
        timestamp: 'integer',
        syncTimestamp: 'integer',
        gasUsed: 'string',
        gasFee: 'string',
        storageCollateralized: 'string',
        gasCoveredBySponsor: 'boolean',
        storageCoveredBySponsor: 'boolean',
        storageReleased: ['object'],
        txExecErrorMsg: OpenAPI.schema({ type: 'string', nullable: true }),
        txExecErrorInfo: 'object', // XXX
        confirmedEpochCount: 'integer', // XXX
        cfxTransferCount: 'integer',
        cfxTransferAllCount: 'integer',
        eventLogCount: 'integer',
        // aggregated info
        tokenTransfer: 'object',
        tokenTransferContractInfo: 'object',
        tokenTransferTokenInfo: 'object',
        tokenTransferENSInfo: 'object',
        tokenTransferNameTagInfo: 'object',
        type: 'integer',
        typeDesc: 'string',
        baseFeePerGas: 'integer',
        maxFeePerGas: 'integer',
        maxPriorityFeePerGas: 'integer',
        burntGasFee: 'integer',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  // jsonrpc.methodFlow('queryTransaction'),
  async function(arg, next, end) {
    return jsonrpc.queryTransaction.call(this, [arg], next, end)
  },

  async function (transaction) {
    const {
      app: { tool, service, logger },
    } = this as ScanCtx;

    if (transaction) {
      try {
        const confirmedEpochNumber = await service.conflux.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_CONFIRMED);
        transaction.confirmedEpochCount = Math.max(confirmedEpochNumber - transaction.epochNumber, 0);
        transaction.txExecErrorInfo = transaction.txExecErrorMsg
          ? tool.parseTransactionMessage(transaction.txExecErrorMsg)
          : undefined;
        // aggregate log info
        const eventLog = await jsonrpc.methodFlow('listEventLogByTransactionHash')
          .call(this, { transactionHash: transaction?.hash || 0 });
        transaction.eventLogCount = eventLog.total;
      } catch (e) {
        logger.error({ src: 'aggregate event_log for transaction', msg: e.toString() });
      }

      if (transaction.aggregate) {
        try {
          // aggregate transfer info
          const tokenTransfer = await jsonrpc.methodFlow('countAndListTransfer')
            .call(this, { transactionHash: transaction.hash, limit: 100, reverse: true /* casFilter: false */ });
          transaction.tokenTransfer = tokenTransfer || [];
          // aggregate contract and token info
          const addressArray = [];
          tokenTransfer.list.forEach((transfer) => {
            addressArray.push(transfer.from.toString());
            addressArray.push(transfer.to.toString());
            if (transfer.address !== undefined) addressArray.push(transfer.address.toString());
          });
          const accountBasic = await jsonrpc.methodFlow('queryAccountBasic').call(this, { addressArray });
          const contractAddressArray = Object.keys(accountBasic.map);
          transaction.tokenTransferContractInfo = {};
          transaction.tokenTransferTokenInfo = {};
          transaction.tokenTransferENSInfo = {};
          transaction.tokenTransferNameTagInfo = {};
          contractAddressArray.forEach((address) => {
            transaction.tokenTransferContractInfo[address] = accountBasic.map[address]?.contract;
            transaction.tokenTransferTokenInfo[address] = accountBasic.map[address]?.token;
            transaction.tokenTransferENSInfo[address] = accountBasic.map[address]?.ens;
            transaction.tokenTransferNameTagInfo[address] = accountBasic.map[address]?.nameTag;
          });
        } catch (e) {
          logger.error({ src: 'aggregate contract and token for transaction', msg: e.toString() });
        }
      }
    }
    return transaction;
  },
  (transaction) => transaction || {}, // XXX: null => {}, cause http json can not handle null good
);
router.get('/transaction',
  OpenAPI.flow({
    tags: ['transaction'],
    input: {
      blockHash: { in: 'query', type: 'string', description: 'use alone' },
      accountAddress: { in: 'query', type: 'string', nullable: true },

      minTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      maxTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      from: { in: 'query', type: 'string', nullable: true }, // new add
      to: { in: 'query', type: 'string', nullable: true }, // new add
      transactionHash: { in: 'query', type: 'string', nullable: true }, // new add
      txType: { in: 'query', type: 'string', enum: [...Object.values(CONST.TX_TYPE), 'create'] },
      status: { in: 'query', type: 'integer', enum: [CONST.TX_STATUS.FAILED] },

      minEpochNumber: { in: 'query', type: 'integer', minimum: 0 },
      maxEpochNumber: { in: 'query', type: 'integer', minimum: 0 },
      nonce: { in: 'query', type: 'integer', minimum: 0 },
      reverse: { in: 'query', type: 'boolean', default: true }, // XXX: front-end is lazy to input 'true'
      skip: { in: 'query', type: 'integer', minimum: 0, default: 0 },
      limit: { in: 'query', type: 'integer', minimum: 0, maximum: 100, default: 10 },
      fields: {
        in: 'query', type: 'array', default: ['risk', 'gasFee'],
        items: { type: 'string', enum: ['risk', 'gasCoveredBySponsor', 'gasFee', 'gasUsed', 'stateRoot', 'storageCollateralized', 'storageCoveredBySponsor', 'storageReleased', 'txExecErrorMsg'] },
      },
    },
    output: {
      200: {
        total: 'integer',
        listLimit: OpenAPI.schema({ type: 'integer', description: 'if exist, require skip+limit <= listLimit' }),
        ensInfo: 'object',
        list: [{
          blockHash: 'string',
          method: 'string',
          transactionIndex: 'integer',
          epochHeight: 'integer',
          nonce: 'string',
          hash: 'string',
          from: 'string',
          to: OpenAPI.schema({ type: 'string', nullable: true }),
          value: 'string',
          gasPrice: 'string',
          gas: 'string',
          contractCreated: OpenAPI.schema({ type: 'string', nullable: true }),
          status: 'integer',
          timestamp: 'integer',
          epochNumber: 'integer',
          syncTimestamp: 'integer',
          risk: 'number',
          gasFee: 'string',
          gasUsed: 'string',
          fromENSInfo: 'object',
          fromNameTagInfo: 'object',
          toContractInfo: 'object',
          toTokenInfo: 'object',
          toENSInfo: 'object',
          toNameTagInfo: 'object',
          txExecErrorMsg: OpenAPI.schema({ type: 'string', nullable: true }),
        }],
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  // jsonrpc.methodFlow('countAndListTransaction'),
  async function (arg, next, end) {
    return jsonrpc.countAndListTransaction.call(this, [arg], next, end)
  },

  async function (result) {
    let addressArray = [];
    result.list.forEach((tx) => {
      addressArray.push(tx.from.toString());
      tx.to && (addressArray.push(tx.to.toString()));
    });
    const accountBasic = await jsonrpc.methodFlow('queryAccountBasic').call(this, { addressArray });
    result.list.forEach((tx) => {
      tx.fromENSInfo = accountBasic.map[tx.from]?.ens;
      tx.fromNameTagInfo = accountBasic.map[tx.from]?.nameTag;
      tx.to && (tx.toContractInfo = accountBasic.map[tx.to]?.contract);
      tx.to && (tx.toTokenInfo = accountBasic.map[tx.to]?.token);
      tx.to && (tx.toENSInfo = accountBasic.map[tx.to]?.ens);
      tx.to && (tx.toNameTagInfo = accountBasic.map[tx.to]?.nameTag);
    });
    return result;
  },
);

// -------------------------------- Account ---------------------------------
router.get('/account/:address',
  OpenAPI.flow({
    tags: ['account'],
    input: {
      address: { in: 'path', type: 'string', required: true },
      fields: {
        in: 'query', type: 'array',
        items: { type: 'string', enum: ['blockCount', 'transactionCount', 'cfxTransferCount', 'erc20TransferCount', 'erc777TransferCount', 'erc721TransferCount', 'erc1155TransferCount'] },
      },
    },
    output: {
      200: {
        address: 'string',
        balance: 'string',
        stakingBalance: 'string',
        collateralForStorage: 'string',
        collateralForStorageInfo: 'object',
        accumulatedInterestReturn: 'string',
        nonce: 'string',
        admin: 'string',
        codeHash: 'string',
        cfxTransferTab: 'integer',
        erc20TransferTab: 'integer',
        erc721TransferTab: 'integer',
        erc1155TransferTab: 'integer',
        nftAssetTab: 'integer',
        minedBlockTab: 'integer',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('queryAccount'),
);

// -------------------------------- Contract --------------------------------
router.post('/contract',
  OpenAPI.flow({
    tags: ['contract'],
    input: {
      address: { type: 'string', required: true },
      password: { type: 'string' },
      name: { type: 'string' },
      website: { type: 'string', description: 'url website' },
      abi: { type: 'string', description: 'abi json string' },
      sourceCode: { type: 'string', description: 'solidity code' },
      icon: { type: 'string', description: 'base64' },

      // XXX: register token for compatible old api
      token: { type: { icon: 'string' }, description: 'token info object' },
    },
    output: {
      200: [
        {
          epochNumber: 'integer',
          blockHash: 'string',
          transactionHash: 'string',
          outcomeStatus: 'integer',
          from: 'string',
          to: 'string',
          gasUsed: 'string',
          gasFee: 'string',
        },
      ],
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('registerContract'),
);

router.delete('/contract/:address',
  OpenAPI.flow({
    tags: ['contract'],
    input: {
      address: { in: 'path', type: 'string', required: true },
      password: { type: 'string' },
    },
    output: {
      200: [
        {
          epochNumber: 'integer',
          blockHash: 'string',
          transactionHash: 'string',
          outcomeStatus: 'integer',
          from: 'string',
          to: 'string',
          gasUsed: 'string',
          gasFee: 'string',
        },
      ],
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('deregisterContract'),
);

// FIXME: remove
router.get('/contract/internals',
  OpenAPI.flow({
    tags: ['contract'],
    input: {},
    output: {
      200: {
        total: 'integer',
        listLimit: OpenAPI.schema({ type: 'integer', description: 'if exist, require skip+limit <= listLimit' }),
        list: [
          {
            name: 'string',
            icon: 'string',
            iconUrl: 'string',
            address: 'string',
            transactionCount: 'integer',
            txCount: 'integer', // XXX: drop
          },
        ],
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  async function (options, next, end) {
    const {
      app: { networkId },
    } = this;

    // const internalContracts = (networkId === 1029) ? CONST.INTERNAL_CONTRACT.slice(0, 3)
    //   : CONST.INTERNAL_CONTRACT;
    options = {
      addressArray: CONST.INTERNAL_CONTRACT,
      fields: ['transactionCount'],
      ...options,
    };
    return jsonrpc.methodFlow('countAndListContract').call(this, options, next, end);
  },

  (result) => {
    lodash.forEach(result.list, (contract) => {
      contract.txCount = contract.transactionCount;
    });
    return result;
  },
);

router.get('/contract/compiler',
  OpenAPI.flow({
    tags: ['contract'],
    output: {
      200: 'object',
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('listVersion'),
);

router.get('/contract/license',
  OpenAPI.flow({
    tags: ['contract'],
    output: {
      200: 'object',
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('listLicense'),
);

router.get('/contract/evm-version',
    OpenAPI.flow({
      tags: ['contract'],
      output: {
        200: 'object',
        600: { code: 'integer', message: 'string' },
      },
    }),

    jsonrpc.methodFlow('listEVMVersion'),
);

router.post('/contract/verify',
  OpenAPI.flow({
    tags: ['contract'],
    input: {
      address: { type: 'string', required: true },
      name: { type: 'string', description: 'name in contract file' },
      sourceCode: { type: 'string', description: 'contract source code' },
      compiler: { type: 'string', description: 'compiler version' },
      optimizeRuns: { type: 'integer', nullable: true },
      license: { type: 'string', description: 'open source license' },
      constructorArgs: { type: 'string', description: 'constructor arguments' },
      libraryName1: { type: 'string', description: 'if applicable, a matching pair with libraryaddress1 required' },
      libraryAddress1: { type: 'string', description: 'if applicable, a matching pair with libraryname1 required' },
      libraryName2: { type: 'string', description: 'if applicable, matching pair required' },
      libraryAddress2: { type: 'string', description: 'if applicable, matching pair required' },
      libraryName3: { type: 'string', description: 'if applicable, matching pair required' },
      libraryAddress3: { type: 'string', description: 'if applicable, matching pair required' },
      libraryName4: { type: 'string', description: 'if applicable, matching pair required' },
      libraryAddress4: { type: 'string', description: 'if applicable, matching pair required' },
      libraryName5: { type: 'string', description: 'if applicable, matching pair required' },
      libraryAddress5: { type: 'string', description: 'if applicable, matching pair required' },
      libraryName6: { type: 'string', description: 'if applicable, matching pair required' },
      libraryAddress6: { type: 'string', description: 'if applicable, matching pair required' },
      libraryName7: { type: 'string', description: 'if applicable, matching pair required' },
      libraryAddress7: { type: 'string', description: 'if applicable, matching pair required' },
      libraryName8: { type: 'string', description: 'if applicable, matching pair required' },
      libraryAddress8: { type: 'string', description: 'if applicable, matching pair required' },
      libraryName9: { type: 'string', description: 'if applicable, matching pair required' },
      libraryAddress9: { type: 'string', description: 'if applicable, matching pair required' },
      libraryName10: { type: 'string', description: 'if applicable, matching pair required' },
      libraryAddress10: { type: 'string', description: 'if applicable, matching pair required' },
      evmVersion: {
        type: 'string',
        description: `leave blank for compiler default, homestead, tangerineWhistle, spuriousDragon, byzantium, 
        constantinople, petersburg, istanbul (applicable when codeformat=solidity-single-file)`
      },
    },
    output: {
      200: {
        name: 'string',
        version: 'string',
        sourceCode: 'string',
        optimizeRuns: 'integer',
        abi: 'object',
        exactMatch: 'boolean',
        warnings: ['string'],
        errors: ['string'],
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('verifyContract'),
);

router.get('/contract/verified',
  OpenAPI.flow({
    tags: ['contract'],
    input: {
      addressArray: { in: 'query', type: 'array', items: { type: 'string' } },
      reverse: { in: 'query', type: 'boolean', default: true },
      skip: { in: 'query', type: 'integer', minimum: 0, default: 0 },
      limit: { in: 'query', type: 'integer', minimum: 0, maximum: 200, default: 10 },
    },
    output: {
      200: {
        total: 'integer',
        list: [
          {
            name: 'string',
            address: 'string',
            compiler: 'string',
            version: 'string',
            optimization: 'boolean',
            runs: 'integer',
            timestamp: 'integer',
            transactionCount: 'integer',
            balance: 'string',
          },
        ],
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('listContractVerified'),
);

router.get('/contract/:address',
  OpenAPI.flow({
    tags: ['contract'],
    input: {
      address: { in: 'path', type: 'string', required: true },
      fields: {
        in: 'query', type: 'array',
        items: {
          type: 'string',
          enum: [
            'blockCount', 'transactionCount', 'cfxTransferCount', 'erc20TransferCount', 'erc777TransferCount', 'erc721TransferCount', 'erc1155TransferCount',
            'name', 'website', 'abi', 'sourceCode', 'icon', 'code', 'sponsor', 'admin', 'token',
          ],
        },
      },
    },
    output: {
      200: {
        address: 'string',
        balance: 'string',
        stakingBalance: 'string',
        collateralForStorage: 'string',
        collateralForStorageInfo: 'object',
        accumulatedInterestReturn: 'string',
        nonce: 'string',
        admin: 'string',
        codeHash: 'string',
        cfxTransferTab: 'integer',
        erc20TransferTab: 'integer',
        erc721TransferTab: 'integer',
        erc1155TransferTab: 'integer',
        nftAssetTab: 'integer',
        minedBlockTab: 'integer',
        epochNumber: 'integer',
        from: 'string',
        transactionHash: 'string',
        name: 'string',
        website: 'string',
        abi: 'string',
        sourceCode: 'string',
        code: 'string',
        sponsor: {
          sponsorGasBound: 'string',
          sponsorBalanceForGas: 'string',
          sponsorBalanceForCollateral: 'string',
          sponsorForGas: 'string',
          sponsorForCollateral: 'string',
          sponsorForGasContractInfo: 'object',
          sponsorForCollateralContractInfo: 'object',
          sponsorForGasENSInfo: 'object',
          sponsorForCollateralENSInfo: 'object',
          sponsorForGasNameTagInfo: 'object',
          sponsorForCollateralNameTagInfo: 'object',
        },
        token: {
          name: 'string',
          symbol: 'string',
          icon: 'string',
          iconUrl: 'string',
          website: 'string',
          ipfsGateway: 'string',
          transferType: 'string',
        },
        verify: 'object',
        proxy: 'object',
        beacon: 'object',
        destroy: 'object',
        implementation: 'object',
        isRegistered: 'boolean',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('queryContract'),

  async function (result) {
    const {
      app: { type },
    } = this;

    if (result.sponsor === undefined) return result;

    const { sponsor } = result;
    const sponsorForGas = sponsor?.sponsorForGas ? type.simpleAddress(sponsor?.sponsorForGas) : '';
    const sponsorForCollateral = sponsor?.sponsorForCollateral ? type.simpleAddress(sponsor?.sponsorForCollateral) : '';
    let addressArray = [];
    addressArray.push(sponsorForGas);
    addressArray.push(sponsorForCollateral);
    addressArray = addressArray.filter((item) => item !== '');
    const accountBasic = await jsonrpc.methodFlow('queryAccountBasic').call(this, { addressArray });
    result.sponsor.sponsorForGasContractInfo = accountBasic.map[sponsorForGas]?.contract;
    result.sponsor.sponsorForCollateralContractInfo = accountBasic.map[sponsorForCollateral]?.contract;
    result.sponsor.sponsorForGasENSInfo = accountBasic.map[sponsorForGas]?.ens;
    result.sponsor.sponsorForCollateralENSInfo = accountBasic.map[sponsorForCollateral]?.ens;
    result.sponsor.sponsorForGasNameTagInfo = accountBasic.map[sponsorForGas]?.nameTag;
    result.sponsor.sponsorForCollateralNameTagInfo = accountBasic.map[sponsorForCollateral]?.nameTag;

    return result;
  },
);

router.get('/contract',
  OpenAPI.flow({
    tags: ['contract'],
    input: {
      addressArray: { in: 'query', type: 'array', items: { type: 'string' } },
      from: { in: 'query', type: 'string' },
      minTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      maxTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      minEpochNumber: { in: 'query', type: 'integer', minimum: 0 },
      maxEpochNumber: { in: 'query', type: 'integer', minimum: 0 },
      reverse: { in: 'query', type: 'boolean', default: false },
      skip: { in: 'query', type: 'integer', minimum: 0, default: 0 },
      limit: { in: 'query', type: 'integer', minimum: 0, maximum: 100, default: 10 },
      fields: { in: 'query', type: 'array', items: { type: 'string', enum: ['name', 'website', 'abi', 'sourceCode', 'icon'] } },
    },
    output: {
      200: {
        total: 'integer',
        listLimit: OpenAPI.schema({ type: 'integer', description: 'if exist, require skip+limit <= listLimit' }),
        list: [
          {
            epochNumber: 'integer',
            address: 'string',
            from: 'string',
            transactionHash: 'string',
            admin: 'string',
            name: 'string',
            website: 'string',
            abi: 'string',
            sourceCode: 'string',
            icon: 'string',
            iconUrl: 'string',
          },
        ],
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('countAndListContract'),
);

// ------------------------- Contract and Token -----------------------------
router.get('/contract-and-token',
  OpenAPI.flow({
    tags: ['contract'],
    input: {
      address: { in: 'query', type: 'array', items: { type: 'string' } },
    },
    output: {
      200: {
        total: 'integer',
        map: 'object',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  async function (options) {
    return jsonrpc.methodFlow('queryContractBasic').call(this, { addressArray: options.address });
  },
);

/*router.get('/contractBasic',
  OpenAPI.flow({
    tags: ['contract'],
    input: {
      addressArray: { in: 'query', type: 'array', items: { type: 'string' } },
    },
    output: {
      200: {
        total: 'integer',
        map: 'object',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('queryContractBasic'),
);*/

// ---------------------------------- Token ---------------------------------
router.post('/token',
  OpenAPI.flow({
    tags: ['token'],
    input: {
      address: { type: 'string', required: true },
      password: { type: 'string' },
      icon: { type: 'string', description: 'base64' },
      marketCapId: { type: 'integer' },
      quoteUrl: { type: 'string' },
      moonDexSymbol: { type: 'string' },
      binanceSymbol: { type: 'string' },
      ipfsGateway: { type: 'string' },
    },
    output: {
      200: [
        {
          epochNumber: 'integer',
          blockHash: 'string',
          transactionHash: 'string',
          outcomeStatus: 'integer',
          from: 'string',
          to: 'string',
          gasUsed: 'string',
          gasFee: 'string',
        },
      ],
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('registerToken'),
);

router.delete('/token/:address',
  OpenAPI.flow({
    tags: ['token'],
    input: {
      address: { in: 'path', type: 'string', required: true },
      password: { type: 'string' },
    },
    output: {
      200: [
        {
          epochNumber: 'integer',
          blockHash: 'string',
          transactionHash: 'string',
          outcomeStatus: 'integer',
          from: 'string',
          to: 'string',
          gasUsed: 'string',
          gasFee: 'string',
        },
      ],
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('deregisterToken'),
);

router.get('/token/:address',
  OpenAPI.flow({
    tags: ['token'],
    input: {
      address: { in: 'path', type: 'string', required: true },
      fields: {
        in: 'query', type: 'array', default: ['price'],
        items: { type: 'string', enum: ['icon', 'price'] },
      },
    },
    output: {
      200: {
        address: 'string',
        name: 'string',
        symbol: 'string',
        decimals: 'integer',
        granularity: 'integer',
        totalSupply: 'string',

        transferType: 'string',
        transferCount: 'integer',
        holderCount: 'integer',

        price: OpenAPI.schema({ type: 'number', nullable: true }),
        totalPrice: 'number',
        quoteUrl: 'string',
        marketCapId: 'number',
        moonDexSymbol: 'string',
        binanceSymbol: 'string',

        icon: 'string',
        iconUrl: 'string',
        website: 'string',
        holderIncreasePercent: 'number',
        isRegistered: 'boolean',
        verified: 'boolean',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('queryToken'),
);

router.get('/token',
  OpenAPI.flow({
    tags: ['token'],
    input: {
      transferType: { in: 'query', type: 'string' },
      addressArray: { in: 'query', type: 'array', items: { type: 'string' }, description: 'use alone' },
      accountAddress: { in: 'query', type: 'string', description: 'use alone' },
      name: { in: 'query', type: 'string', description: 'regex' },
      orderBy: { in: 'query', type: 'string', default: 'transferCount' },
      reverse: { in: 'query', type: 'boolean', default: true },
      skip: { in: 'query', type: 'integer', minimum: 0, default: 0 },
      limit: { in: 'query', type: 'integer', minimum: 0, maximum: 100, default: 100 },
      fields: {
        in: 'query', type: 'array', default: ['price'],
        items: { type: 'string', enum: ['icon', 'price'] },
      },
    },
    output: {
      200: {
        total: 'integer',
        listLimit: OpenAPI.schema({ type: 'integer', description: 'if exist, require skip+limit <= listLimit' }),
        list: [
          {
            address: 'string',
            name: 'string',
            symbol: 'string',
            decimals: 'integer',
            granularity: 'integer',
            totalSupply: 'string',
            holderCount: 'integer',
            transferCount: 'integer',
            transferType: 'string',
            icon: 'string',
            iconUrl: 'string',
            accountAddress: OpenAPI.schema({ type: 'string', description: 'show with accountAddress' }),
            balance: OpenAPI.schema({ type: 'string', description: 'show with accountAddress' }),
            quoteUrl: 'string',
            price: OpenAPI.schema({ type: 'number', nullable: true }),
            totalPrice: 'number',
            contractName: 'string',
            ensInfo: 'object',
            nameTagInfo: 'object',
          },
        ],
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('countAndListToken'),

  async function (result) {
    const addressArray = result.list.map(token => token.address);
    const accountBasic = await jsonrpc.methodFlow('queryAccountBasic').call(this, { addressArray });
    result.list.forEach((token) => {
      token.contractName = accountBasic.map[token.address]?.contract?.name;
      token.ensInfo = accountBasic.map[token.address]?.ens;
      token.nameTagInfo = accountBasic.map[token.address]?.nameTag;
    });
    return result;
  },
);

router.post('/token/audit',
  OpenAPI.flow({
    tags: ['token'],
    input: {
      address: { type: 'string', required: true },
      password: { type: 'string' },
      verify: { type: 'boolean' },
      audit: { type: 'boolean' },
      sponsor: { type: 'boolean' },
      zeroAdmin: { type: 'boolean' },
      cexBinance: { type: 'string' },
      cexHuobi: { type: 'string' },
      cexOKEx: { type: 'string' },
      dexMoonSwap: { type: 'string' },
      trackCoinMarketCap: { type: 'string' },
    },
    output: {
      200: 'object',
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('auditToken'),
);

// ------------------------------- Transfer ---------------------------------
router.get('/transfer',
  buildCheckAddressRateFn('address'),
  OpenAPI.flow({
    tags: ['transfer'],
    input: {
      transferType: { in: 'query', type: 'string', enum: Object.values(CONST.TRANSFER_TYPE) },
      accountAddress: { in: 'query', type: 'string' },
      address: { in: 'query', type: 'string' },
      minTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      maxTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      from: { in: 'query', type: 'string', nullable: true }, // new add
      to: { in: 'query', type: 'string', nullable: true }, // new add
      transactionHash: { in: 'query', type: 'string', description: 'use alone', nullable: true },
      tokenId: { in: 'query', type: 'string' },
      txType: { in: 'query', type: 'string', enum: [...Object.values(CONST.TX_TYPE), 'create'] }, // new add
      status: { in: 'query', type: 'integer', enum: [CONST.TX_STATUS.FAILED] }, // new add
      zeroValue: { in: 'query', type: 'boolean', default: false },
      tokenArray: { in: 'query', type: 'array', items: { type: 'string' } },

      minEpochNumber: { in: 'query', type: 'integer', minimum: 0 },
      maxEpochNumber: { in: 'query', type: 'integer', minimum: 0 },
      reverse: { in: 'query', type: 'boolean', default: true }, // XXX: front-end is lazy to input 'true'
      skip: { in: 'query', type: 'integer', minimum: 0, default: 0 },
      limit: { in: 'query', type: 'integer', minimum: 0, maximum: 100, default: 10 },
      // casFilter: { in: 'query', type: 'boolean', default: true },
    },
    output: {
      200: {
        total: 'integer',
        listLimit: OpenAPI.schema({ type: 'integer', description: 'if exist, require skip+limit <= listLimit' }),
        list: [
          {
            epochNumber: 'integer',
            transactionHash: 'string',
            transactionLogIndex: 'integer',
            transactionTraceIndex: 'integer',
            batchIndex: 'integer',
            address: 'string',
            from: 'string',
            to: 'string',
            fromEnsInfo: 'object',
            toEnsInfo: 'object',
            operator: 'string',
            tokenId: 'string',
            value: 'string',
            timestamp: 'integer',
            syncTimestamp: 'integer',
            transferType: 'string', // for filter by 'transactionHash'
            type: 'string', // for transferType is 'CFX'
            fromContractInfo: 'object',
            fromTokenInfo: 'object',
            fromENSInfo: 'object',
            fromESpaceInfo: 'object',
            fromNameTagInfo: 'object',
            toContractInfo: 'object',
            toTokenInfo: 'object',
            toENSInfo: 'object',
            toESpaceInfo: 'object',
            toNameTagInfo: 'object',
            transferContractInfo: 'object',
            transferTokenInfo: 'object',
            transferENSInfo: 'object',
            transferNameTagInfo: 'object',
          },
        ],
      },
      600: { code: 'integer', message: 'string' },
      429: { code: 'integer', message: 'string' },
    },
  }),

  // jsonrpc.methodFlow('countAndListTransfer'),
  async function (arg, next, end) {
    return jsonrpc.countAndListTransfer.call(this, [arg], next, end)
  },

  async function (result) {
    const {
      app: { type },
    } = this;

    let addressArray = [];
    result.list.forEach((transfer) => {
      addressArray.push(transfer.from.toString());
      addressArray.push(transfer.to.toString());
      if (transfer.address !== undefined) addressArray.push(transfer.address.toString());
    });
    addressArray = addressArray.filter((e) => e?.length > 40); // filter 0xundefined.
    const accountBasic = await jsonrpc.methodFlow('queryAccountBasic').call(this, { addressArray });
    result.list.forEach((transfer) => {
      transfer.fromContractInfo = accountBasic.map[transfer.from]?.contract;
      transfer.fromTokenInfo = accountBasic.map[transfer.from]?.token;
      transfer.fromENSInfo = accountBasic.map[transfer.from]?.ens;
      transfer.fromESpaceInfo = accountBasic.map[transfer.from]?.eSpace;
      transfer.fromNameTagInfo = accountBasic.map[transfer.from]?.nameTag;
      transfer.toContractInfo = accountBasic.map[transfer.to]?.contract;
      transfer.toTokenInfo = accountBasic.map[transfer.to]?.token;
      transfer.toENSInfo = accountBasic.map[transfer.to]?.ens;
      transfer.toESpaceInfo = accountBasic.map[transfer.to]?.eSpace;
      transfer.toNameTagInfo = accountBasic.map[transfer.to]?.nameTag;
      transfer.transferTokenInfo = accountBasic.map[transfer.address]?.token;
      transfer.transferContractInfo = accountBasic.map[transfer.address]?.contract;
      transfer.transferENSInfo = accountBasic.map[transfer.address]?.ens;
      transfer.transferNameTagInfo = accountBasic.map[transfer.address]?.nameTag;
    });
    return result;
  },
);

router.get('/transferTree/:transactionHash',
  OpenAPI.flow({
    tags: ['transfer'],
    input: {
      transactionHash: { in: 'path', type: 'string', required: true },
    },
    output: {
      200: 'object',
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('transferTreeByTransactionHash'),

  async function (result) {
    if (result.addressArray === undefined) {
      return result;
    }

    const addressArray = [];
    result.addressArray.forEach((address) => {
      addressArray.push(address.toString());
    });
    const accountBasic = await jsonrpc.methodFlow('queryAccountBasic').call(this, { addressArray });
    const contractAddressArray = Object.keys(accountBasic.map);
    result.contractMap = {};
    result.tokenMap = {};
    result.ensMap = {};
    result.nameTagMap = {};
    contractAddressArray.forEach((address) => {
      result.contractMap[address] = accountBasic.map[address]?.contract;
      result.tokenMap[address] = accountBasic.map[address]?.token;
      result.ensMap[address] = accountBasic.map[address]?.ens;
      result.nameTagMap[address] = accountBasic.map[address]?.nameTag;
    });
    return result;
  },
);

// ----------------------------------- EventLog ---------------------------------
router.get('/eventLog',
  OpenAPI.flow({
    tags: ['eventLog'],
    input: {
      transactionHash: { in: 'query', type: 'string', required: true },
      aggregate: { in: 'query', type: 'boolean', default: false },
    },
    output: {
      200: {
        total: 'integer',
        list: [
          {
            epochNumber: 'integer',
            transactionHash: 'string',
            transactionLogIndex: 'integer',
            address: 'string',
            data: 'string',
            topics: ['string'],
            ensInfo: 'object',
            nameTagInfo: 'object',
          },
        ],
        logContractInfo: 'object',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('listEventLogByTransactionHash'),

  async function (result) {
    const {
      app: { type },
    } = this;
    result.list.forEach(item => item.address = type.simpleAddress(item.address));

    const addressArray = result.list.map(item => item.address);
    const accountBasic = await jsonrpc.methodFlow('queryAccountBasic').call(this, { addressArray });
    result.list.forEach(item => {
      item.ensInfo = accountBasic.map[item.address]?.ens;
      item.nameTagInfo = accountBasic.map[item.address]?.nameTag;
    });

    return result;
  },
);

// ---------------------------------- ENS -------------------------------------
router.get('/ens/reverse/match',
    OpenAPI.flow({
      tags: ['contract'],
      input: {
        address: { in: 'query', type: 'array', items: { type: 'string' } },
      },
      output: {
        200: {
          total: 'integer',
          map: 'object',
        },
        600: { code: 'integer', message: 'string' },
      },
    }),

    async function (options) {
      const accountBasic = await jsonrpc.methodFlow('queryAccountBasic').call(this, { addressArray: options.address });
      const map = {};
      Object.keys(accountBasic.map).forEach(address => (map[address] = accountBasic.map[address]?.ens));
      return {
        total: Object.keys(map).length,
        map,
      };
    },
);

// -------------------------------- name tag ----------------------------------
router.get('/nametag',
    OpenAPI.flow({
      tags: ['contract'],
      input: {
        address: { in: 'query', type: 'array', items: { type: 'string' } },
      },
      output: {
        200: {
          total: 'integer',
          map: 'object',
        },
        600: { code: 'integer', message: 'string' },
      },
    }),

    async function (options) {
      const accountBasic = await jsonrpc.methodFlow('queryAccountBasic').call(this, { addressArray: options.address });
      const map = {};
      Object.keys(accountBasic.map).forEach(address => (map[address] = accountBasic.map[address]?.nameTag));
      return {
        total: Object.keys(map).length,
        map,
      };
    },
);

// ----------------------------------- Report ---------------------------------
router.get('/report/transaction',
  OpenAPI.flow({
    tags: ['exporter'],
    input: {
      accountAddress: { in: 'query', type: 'string' },
      txType: { in: 'query', type: 'string' },
      status: { in: 'query', type: 'integer' },
      minTimestamp: { in: 'query', type: 'integer' },
      maxTimestamp: { in: 'query', type: 'integer' },
      minEpochNumber: { in: 'query', type: 'integer' },
      maxEpochNumber: { in: 'query', type: 'integer' },
      limit: { in: 'query', type: 'integer' },
      skip: { in: 'query', type: 'integer' },
      reverse: { in: 'query', type: 'boolean' },
      token: { in: 'query', type: 'string' },

      blockHash: { in: 'query', type: 'string', description: 'use alone' },
      transactionHash: { in: 'query', type: 'string', nullable: true }, // new add
      nonce: { in: 'query', type: 'integer', minimum: 0 }, // new add
      from: { in: 'query', type: 'string', nullable: true }, // new add
      to: { in: 'query', type: 'string', nullable: true }, // new add
    },
    output: {
      200: 'string',
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('exportTransaction'),
  async function (options) {
    const {
      app: { type },
    } = this;
    const {address, csvContent} = options;
    const date = moment(new Date()).format('YYYY.MM.DD')
    const filename = `address-transactions-${StatApp.isEVM ? type.address(address) : address}-${date}.csv`;
    this.set('Content-Disposition', `attachment; filename="${filename}"`);
    return Buffer.from(csvContent);
  },
);

router.get('/report/transfer',
  OpenAPI.flow({
    tags: ['exporter'],
    input: {
      transferType: { in: 'query', type: 'string', enum: Object.values(CONST.TRANSFER_TYPE) },
      accountAddress: { in: 'query', type: 'string' },
      address: { in: 'query', type: 'string' },
      minTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      maxTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      from: { in: 'query', type: 'string', nullable: true }, // new add
      to: { in: 'query', type: 'string', nullable: true }, // new add
      transactionHash: { in: 'query', type: 'string', description: 'use alone', nullable: true },
      tokenId: { in: 'query', type: 'string' },
      txType: { in: 'query', type: 'string', enum: [...Object.values(CONST.TX_TYPE), 'create'] }, // new add
      status: { in: 'query', type: 'integer', enum: [CONST.TX_STATUS.FAILED] }, // new add
      zeroValue: { in: 'query', type: 'boolean', default: false },
      tokenArray: { in: 'query', type: 'array', items: { type: 'string' } }, // new add

      minEpochNumber: { in: 'query', type: 'integer', minimum: 0 },
      maxEpochNumber: { in: 'query', type: 'integer', minimum: 0 },
      reverse: { in: 'query', type: 'boolean', default: true },
      skip: { in: 'query', type: 'integer', minimum: 0, default: 0 },
      limit: { in: 'query', type: 'integer', minimum: 0, maximum: 100, default: 10 },
      token: { in: 'query', type: 'string' },
    },
    output: {
      200: 'string',
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc.methodFlow('exportTransfer'),
  async function (options) {
    const {
      app: { type },
    } = this;

    const {address, contract, tokeSymbol, transferType, csvContent} = options;
    let tag = ''
    switch (transferType){
      case CONST.TRANSFER_TYPE.CFX:
        tag = 'CFXtransactions';
        break;
      case CONST.TRANSFER_TYPE.ERC3525:
      case CONST.TRANSFER_TYPE.ERC20:
        tag = 'token';
        break;
      case CONST.TRANSFER_TYPE.ERC721:
      case CONST.TRANSFER_TYPE.ERC1155:
        tag = 'nfts';
        break;
    }
    const date = moment(new Date()).format('YYYY.MM.DD')
    let filename = address ? `address-${tag}-${StatApp.isEVM ? type.address(address) : address}-${date}.csv`
        : `${tag}-${tokeSymbol}-${StatApp.isEVM ? type.address(contract) : contract}-${date}.csv`;
    this.set('Content-Disposition', `attachment; filename="${filename}"`);
    return Buffer.from(csvContent);
  },
);

// ----------------------------------------------------------------------------
openAPI.loadRouter(router);

module.exports = router;
