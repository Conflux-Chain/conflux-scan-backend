import {ScanCtx} from "../service/index";
import {toArray} from "../../stat/router/ParamChecker";
import {
  jsonrpc_countAndListContract,
  jsonrpc_countAndListToken,
  jsonrpc_countAndListTransaction,
  jsonrpc_countAndListTransfer,
  jsonrpc_dag,
  jsonrpc_exportTransaction, jsonrpc_exportTransfer,
  jsonrpc_frontend,
  jsonrpc_listBlock,
  jsonrpc_listCompilers, jsonrpc_listVyperCompilers,
  jsonrpc_plot,
  jsonrpc_queryBlock,
  jsonrpc_queryContract,
  jsonrpc_queryTransaction,
  jsonrpc_trend,
  jsonrpc_verifyContract, jsonrpc_verifyCrossSpace,
} from "./jsonrpc";
import {CONST} from "../../stat/service/common/constant";
import * as KoaRouter from "koa-router";
import {getClientIP} from "../../stat/router/RateLimiter";
import {safeAddErrorLog} from "../../stat/monitor/ErrorMonitor";
import {getAccountQuery} from "../../stat/service/AccountQuery";
import {fmtAddr} from "../../stat/StatApp";
import {Errors} from "../../stat/service/common/LogicError";
import {HomepageDashboard} from "../../stat/service/HomepageDashboard";
import {ConfigInstance} from "../../stat/config/StatConfig";

const lodash = require('lodash');
const moment = require("moment/moment");
const {router_get, router_post} = require ("../../koaflow/src/koaHelper");
const {OpenAPI} = require('../../koaflow/lib/OpenAPI');
const error = require('../../common/error');
const {StatApp} = require("../../stat/StatApp");
const { buildCheckAddressRateFn } = require('../../stat/router/RateLimiter')
const {patchFlowError} = require("../../koaflow/lib/flow/JsonRPCFlow");

// ----------------------------------------------------------------------------
const router = new KoaRouter();
router.use(async (ctx, next) => {
  const origin = ctx.headers.origin || ctx.headers.Origin;
  if (origin === 'https://dashboard.galxe.com') {
    ctx.set('Access-Control-Allow-Origin', origin);
    ctx.set("Access-Control-Allow-Credentials", "true");
  } else {
    ctx.set('Access-Control-Allow-Origin', '*'); // for "swagger.io"
  }
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
    } else if (e.code === 'INVALID_ARGUMENT'
        || (e.code === 5200 && e.message?.includes("(Invalid input|args"))) {
      e = new Errors.ParameterError(e.message || `${e}`);
    }
    // see common/error.js
    ctx.status = e.status || 500;
    if (ctx.status === 500) {
      e["url"] = ctx.originalUrl;
      safeAddErrorLog('v1', `v1-500-${e.message}`, e).then();
    }
    ctx.body = StatApp.isEVM ? { status: `${e.code}`, message: e.message, result: e.partialData } :
        { code: e.code, message: e.message, data: e.partialData };
  }
});

let startTime = new Date().toLocaleTimeString();
router_get(router,'/', function (ctx) {
  return { message: `scan-api-v1, ${startTime}` };
});
// --------------------------------- OpenAPI ----------------------------------

// -------------------------------- Statistic ---------------------------------
router_get(router,'/dag',
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

  toArray,  jsonrpc_dag
);

router_get(router,'/plot',
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

    toArray, jsonrpc_plot,
);

router_get(router,'/trend',
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

    toArray, jsonrpc_trend,
);

router_get(router, '/homeDashboard',
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

    async function () {
      return HomepageDashboard.getData()?.blockchainInfo;
    },
);

router_get(router,'/frontend',
  OpenAPI.flow({
    tags: ['frontend'],
    input: {
      referer: {in: 'header', type: 'string', required: false},
      host: {in: 'header', type: 'string', required: false},
    },
    output: {
      200: 'object',
      600: { code: 'integer', message: 'string' },
    },
  }),

    toArray, jsonrpc_frontend,

  async function (result) {
    const {app: { service: {accountQuery} },} = this as ScanCtx;
    const addresses = result.contracts.map(item => item.address).filter(Boolean);
    result.nameMap = await accountQuery.list(addresses, {withENSInfo: true, withNameTagInfo: true});
    return result;
  },
);

// --------------------------------- Block ----------------------------------
router_get(router,'/block/:hash',
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

    toArray, jsonrpc_queryBlock,
  (block) => block || {}, // XXX: null => {}, cause http json can not handle null good
);

router_get(router,'/block',
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
            coreBlock: 'boolean',
            burntGasFee: 'integer',
          },
        ],
        nameMap: 'object',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

    toArray, jsonrpc_listBlock,

  async function (result) {
    const {app: { service: {accountQuery} },} = this as ScanCtx;
    const addresses = result.list.map(item => item.miner).filter(Boolean);
    result.nameMap = await accountQuery.list(addresses, {
      withContractInfo: true,
      withENSInfo: true,
      withNameTagInfo: true
    });
    return result;
  },
);

// ------------------------------- Transaction ------------------------------
router_get(router,'/transaction/:hash',
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
        gasCharged: 'string',
        storageCollateralized: 'string',
        gasCoveredBySponsor: 'boolean',
        storageCoveredBySponsor: 'boolean',
        storageReleased: ['object'],
        txExecErrorMsg: OpenAPI.schema({ type: 'string', nullable: true }),
        txExecErrorInfo: 'object', // XXX
        confirmedEpochCount: 'integer', // XXX
        eventLogCount: 'integer',
        type: 'integer',
        typeDesc: 'string',
        baseFeePerGas: 'integer',
        maxFeePerGas: 'integer',
        maxPriorityFeePerGas: 'integer',
        burntGasFee: 'integer',
        nameMap: 'object',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

    toArray, jsonrpc_queryTransaction,

  async function (transaction) {
    const {
      app: { tool, service, },
    } = this as ScanCtx;

    if (transaction) {
      try {
        const confirmedEpochNumber = await service.conflux.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_CONFIRMED);
        transaction.confirmedEpochCount = Math.max(confirmedEpochNumber - transaction.epochNumber, 0);
        transaction.txExecErrorInfo = transaction.txExecErrorMsg
          ? tool.parseTransactionMessage(transaction.txExecErrorMsg)
          : undefined;
      } catch (e) {
        console.error("Failed to get confirmed epoch number", e);
      }
    }
    return transaction;
  },
  (transaction) => transaction || {}, // XXX: null => {}, cause http json can not handle null good
);
router_get(router,'/transaction',
  OpenAPI.flow({
    tags: ['transaction'],
    input: {
      blockHash: { in: 'query', type: 'string', description: 'use alone' },
      accountAddress: { in: 'query', type: 'string', nullable: true },

      minTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      maxTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      from: { in: 'query', type: 'string', nullable: true },
      to: { in: 'query', type: 'string', nullable: true },
      transactionHash: { in: 'query', type: 'string', nullable: true },
      txType: { in: 'query', type: 'string', enum: Object.values(CONST.TX_TYPE) },
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
        list: [{
          method: 'string',
          transactionIndex: 'integer',
          nonce: 'string',
          hash: 'string',
          from: 'string',
          to: OpenAPI.schema({ type: 'string', nullable: true }),
          value: 'string',
          gasPrice: 'string',
          contractCreated: OpenAPI.schema({ type: 'string', nullable: true }),
          status: 'integer',
          timestamp: 'integer',
          epochNumber: 'integer',
          syncTimestamp: 'integer',
          gasFee: 'string',
          txExecErrorMsg: OpenAPI.schema({ type: 'string', nullable: true }),
        }],
        nameMap: 'object',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

    toArray, jsonrpc_countAndListTransaction,

  async function (result) {
    const addresses = new Set<string>(result.list.flatMap(item => [item.from, item.to, item.contractCreated])
        .filter(Boolean));
    result.nameMap = await getAccountQuery().list([...addresses]);

    result.list.forEach((tx) => {
      if (tx.method && !result.nameMap[tx.to]?.contract) {
        tx.method = '0x'
      }
    });

    return result;
  },
);

// -------------------------------- Account ---------------------------------
router_get(router,'/account/:address',
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
  async function(option) {
    const addr = this.app.parseParam(()=>this.app.type.address(option.address));
    const result = await (this as ScanCtx).app.service.account.query({address: addr, fields: option.fields});
    this.app.formatAddrObj(result, ['admin', 'address']);
    return result;
  },
);

// -------------------------------- Contract --------------------------------
router_get(router,'/contract/internals',
  OpenAPI.flow({
    tags: ['contract'],
    input: {},
    output: {
      200: {
        total: 'integer',
        listLimit: OpenAPI.schema({ type: 'integer', description: 'if exist, require skip+limit <= listLimit' }),
        list: [
          {
            address: 'string',
            name: 'string',
            website: 'string',
            admin: 'string',
            transactionCount: 'integer',
          },
        ],
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  async function (options) {
    options = {
      addressArray: CONST.INTERNAL_CONTRACT,
      ...options,
    };
    return options;
  },

  toArray,
  jsonrpc_countAndListContract,
);

router_get(router,'/contract/code-format',
    OpenAPI.flow({
      tags: ['contract'],
      output: {
        200: 'object',
        600: { code: 'integer', message: 'string' },
      },
    }),

    async () => {
      return Object.values(CONST.CONTRACT_CODE_FORMAT_INFO).filter(format => format.code.endsWith('single-file'))
    }
);

router_get(router,'/contract/compiler',
  OpenAPI.flow({
    tags: ['contract'],
    output: {
      200: 'object',
      600: { code: 'integer', message: 'string' },
    },
  }),

  jsonrpc_listCompilers,
);

router_get(router,'/contract/vyper-compiler',
    OpenAPI.flow({
      tags: ['contract'],
      output: {
        200: 'object',
        600: { code: 'integer', message: 'string' },
      },
    }),

    jsonrpc_listVyperCompilers,
);

router_get(router,'/contract/license',
  OpenAPI.flow({
    tags: ['contract'],
    output: {
      200: 'object',
      600: { code: 'integer', message: 'string' },
    },
  }),

  async () => {
    return Object.keys(CONST.CONTRACT_LICENSE).reduce((result, licenseType) => (
        result[licenseType] = CONST.CONTRACT_LICENSE[licenseType].desc, result
    ), {})
  }
);

router_get(router,'/contract/evm-version',
    OpenAPI.flow({
      tags: ['contract'],
      output: {
        200: 'object',
        600: { code: 'integer', message: 'string' },
      },
    }),

    async function () {
      const {app: {service: {contractQuery}},} = this as ScanCtx;
      return contractQuery.listEVMVersions();
    }
);

router_post(router, '/contract/verify',
  OpenAPI.flow({
    tags: ['contract'],
    input: {
      address: { type: 'string', required: true },
      name: { type: 'string', description: 'name in contract file', default: ':' },
      codeFormat: { type: 'string', description: 'contract code format' },
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
        constantinople, petersburg, istanbul (applicable when codeformat=solidity-single-file/vyper-single-file)`
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

  toArray, jsonrpc_verifyContract,
);

router_post(router, '/contract/verify/cross-space',
    OpenAPI.flow({
      tags: ['contract'],
      input: {
        address: { type: 'string', required: true },
        includeAllOtherSpace: { type: 'boolean', default: false },
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

    toArray, jsonrpc_verifyCrossSpace,
);

router_get(router,'/contract/:address',
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
        nameMap: 'object',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  toArray, jsonrpc_queryContract,

  async function (result) {
    if (result.sponsor === undefined) {
      return result;
    }

    const { sponsor } = result;
    const sponsorForGas = fmtAddr(sponsor?.sponsorForGas, StatApp.networkId);
    const sponsorForCollateral = fmtAddr(sponsor?.sponsorForCollateral, StatApp.networkId);
    const addresses = [sponsorForGas, sponsorForCollateral].filter(Boolean);
    const {app: { service: {accountQuery} },} = this as ScanCtx;
    result.nameMap = await accountQuery.list(addresses, {
      withContractInfo: true,
      withENSInfo: true,
      withNameTagInfo: true
    });
    return result;
  },
);

router_get(router,'/contract',
  OpenAPI.flow({
    tags: ['contract'],
    input: {
      addressArray: { in: 'query', type: 'array', items: { type: 'string' } },
    },
    output: {
      200: {
        total: 'integer',
        listLimit: OpenAPI.schema({ type: 'integer', description: 'if exist, require skip+limit <= listLimit' }),
        list: [
          {
            address: 'string',
            name: 'string',
            website: 'string',
            admin: 'string',
          },
        ],
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  toArray,
  jsonrpc_countAndListContract,
);

// ------------------------- Contract and Token -----------------------------
router_get(router,'/contract-and-token',
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
    const {app: {service: {accountQuery}}} = this as ScanCtx
    return accountQuery.listPatchInfo(toArray(options.address), {withContractInfo: true});
  },
);

// ---------------------------------- Token ---------------------------------

router_get(router,'/token/:address',
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
  async function(option) {
    const addr = this.app.parseParam(()=>this.app.type.address(option.address));
    const result = await (this as ScanCtx).app.service.token.query({address: addr});
    this.app.formatAddrObj(result, ['address']);
    return result;
  }
);

router_get(router,'/token',
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
          },
        ],
        nameMap: 'object',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  toArray, jsonrpc_countAndListToken,

  async function (result) {
    const addresses = result.list.map(token => token.address).filter(Boolean);
    const {app: { service: {accountQuery} },} = this as ScanCtx;
    result.nameMap = await accountQuery.list(addresses, {
      withContractInfo: true,
      withENSInfo: true,
      withNameTagInfo: true
    });
    return result;
  },
);

// ------------------------------- Transfer ---------------------------------
router_get(router,'/transfer',
  buildCheckAddressRateFn('address'),
  OpenAPI.flow({
    tags: ['transfer'],
    input: {
      transferType: { in: 'query', type: 'string', enum: Object.values(CONST.TRANSFER_TYPE) },
      accountAddress: { in: 'query', type: 'string' },
      address: { in: 'query', type: 'string' },
      minTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      maxTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      from: { in: 'query', type: 'string', nullable: true },
      to: { in: 'query', type: 'string', nullable: true },
      transactionHash: { in: 'query', type: 'string', description: 'use alone', nullable: true },
      tokenId: { in: 'query', type: 'string' },
      txType: { in: 'query', type: 'string', enum: Object.values(CONST.TX_TYPE) },
      status: { in: 'query', type: 'integer', enum: [CONST.TX_STATUS.FAILED] },
      zeroValue: { in: 'query', type: 'boolean', default: false },
      tokenArray: { in: 'query', type: 'array', items: { type: 'string' } },

      minEpochNumber: { in: 'query', type: 'integer', minimum: 0 },
      maxEpochNumber: { in: 'query', type: 'integer', minimum: 0 },
      reverse: { in: 'query', type: 'boolean', default: true }, // XXX: front-end is lazy to input 'true'
      skip: { in: 'query', type: 'integer', minimum: 0, default: 0 },
      limit: { in: 'query', type: 'integer', minimum: 0, maximum: 100, default: 10 },
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
            operator: 'string',
            tokenId: 'string',
            value: 'string',
            timestamp: 'integer',
            syncTimestamp: 'integer',
            transferType: 'string', // for filter by 'transactionHash'
            type: 'string', // for transferType is 'CFX'
          },
        ],
        nameMap: 'object',
      },
      600: { code: 'integer', message: 'string' },
      429: { code: 'integer', message: 'string' },
    },
  }),

  toArray, jsonrpc_countAndListTransfer,

  async function (result) {
    const {
      app: { service: {accountQuery} },
    } = this as ScanCtx;

    const addresses = result.list.flatMap(item => [item.from, item.to, item.address])
        .filter(item => item && item.length > 40);
    result.nameMap = await accountQuery.list(addresses, {
      withContractInfo: true,
      withNameTagInfo: true,
      withESpaceInfo: true,
      withENSInfo: true
    });
    return result;
  },
);

router_get(router,'/transferTree/:transactionHash',
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

  async function ({transactionHash}) {
    const {app: {service: {accountQuery, conflux}},} = this as ScanCtx;

    const result = await conflux.getTransactionTrace(transactionHash, true);
    if (result.addressArray === undefined) {
      return result;
    }

    result.nameMap = await accountQuery.list(result.addressArray, {
      withContractInfo: true,
      withENSInfo: true,
      withNameTagInfo: true
    });

    return result;
  },
);

// ----------------------------------- EventLog ---------------------------------
router_get(router,'/eventLog',
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
          },
        ],
        nameMap: 'object',
      },
      600: { code: 'integer', message: 'string' },
    },
  }),

  async function (options) {
    options.aggregate = options.aggregate === 'true';
    options.transactionHash = this.app.parseParam(()=>this.app.type.hex64(options.transactionHash))
    const {app: { service: {eventLog} } } = this as ScanCtx;
    const result: any = await eventLog.queryByTransactionHash(options)

    const {app: { service: {accountQuery} },} = this as ScanCtx;
    const addresses = result.list.map(item => item.address);
    result.nameMap = await accountQuery.list(addresses, {withNameTagInfo: true, withENSInfo: true});

    return result;
  },
);

// ---------------------------------- ENS -------------------------------------
router_get(router,'/ens/reverse/match',
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
      const {app: {service: {accountQuery}},} = this as ScanCtx;

      const nameMap = await accountQuery.list(toArray(options.address), {withENSInfo: true});
      const map = lodash.omitBy(Object.fromEntries(Object.keys(nameMap).map(address => [
        address,
        nameMap[address]?.ens
      ])), lodash.isNil);

      return {
        total: Object.keys(map).length,
        map,
      };
    },
);

// -------------------------------- name tag ----------------------------------
router_get(router,'/nametag',
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
      const {app: { service: {accountQuery} },} = this as ScanCtx;
      const accounts = await accountQuery.list(toArray(options.address), {withNameTagInfo: true});
      const map = Object.fromEntries(Object.keys(accounts).map(item => [
        item,
        accounts[item].nameTag,
      ]));
      return {
        total: Object.keys(map).length,
        map,
      };
    },
);

// ----------------------------------- Report ---------------------------------
router_get(router,'/report/transaction',
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
      transactionHash: { in: 'query', type: 'string', nullable: true },
      nonce: { in: 'query', type: 'integer', minimum: 0 },
      from: { in: 'query', type: 'string', nullable: true },
      to: { in: 'query', type: 'string', nullable: true },
    },
    output: {
      200: 'string',
      600: { code: 'integer', message: 'string' },
    },
  }),

  toArray, jsonrpc_exportTransaction,
  async function (options) {
    const {address, csvContent} = options;
    const date = moment(new Date()).format('YYYY.MM.DD')
    const addrSegment = fmtAddr(address, StatApp.networkId) || 'all';
    const filename = `address-transactions-${addrSegment}-${date}.csv`;
    this.set('Content-Disposition', `attachment; filename="${filename}"`);
    return Buffer.from(csvContent);
  },
);

router_get(router,'/report/transfer',
  OpenAPI.flow({
    tags: ['exporter'],
    input: {
      transferType: { in: 'query', type: 'string', enum: Object.values(CONST.TRANSFER_TYPE) },
      accountAddress: { in: 'query', type: 'string' },
      address: { in: 'query', type: 'string' },
      minTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      maxTimestamp: { in: 'query', type: 'integer', minimum: 0 },
      from: { in: 'query', type: 'string', nullable: true },
      to: { in: 'query', type: 'string', nullable: true },
      transactionHash: { in: 'query', type: 'string', description: 'use alone', nullable: true },
      tokenId: { in: 'query', type: 'string' },
      txType: { in: 'query', type: 'string', enum: Object.values(CONST.TX_TYPE) },
      status: { in: 'query', type: 'integer', enum: [CONST.TX_STATUS.FAILED] },
      zeroValue: { in: 'query', type: 'boolean', default: false },
      tokenArray: { in: 'query', type: 'array', items: { type: 'string' } },

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

  toArray, jsonrpc_exportTransfer,
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
    const filename = address ? `address-${tag}-${StatApp.isEVM ? type.address(address) : address}-${date}.csv`
        : `${tag}-${tokeSymbol}-${StatApp.isEVM ? type.address(contract) : contract}-${date}.csv`;
    const encodedFilename = encodeURIComponent(filename);
    const contentDisposition = `attachment; filename*=UTF-8''${encodedFilename}`;
    this.set('Content-Disposition', contentDisposition);
    return Buffer.from(csvContent);
  },
);


// ----------------------------------------------------------------------------

module.exports = router;
