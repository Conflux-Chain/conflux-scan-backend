import {ScanApp, ScanCtx} from "./index";
import {QueryTypes} from "sequelize";
import {NoCoreSpace} from "../../stat/config/StatConfig";

const lodash = require('lodash');
const limitMap = require('limit-map');
const BigFixed = require('bigfixed');
const {StatApp} = require("../../stat/StatApp");
const {FullBlockExt} = require( "../../stat/model/FullBlock")

const DETAIL_FIELDS = ['newTransactionCount', 'avgGasPrice'];
const PIVOT_FIELDS = ['blockIndex', 'pivotHash'];
const REWARD_FIELDS = ['baseReward', 'totalReward', 'txFee'];

export class BlockService {
  app: ScanApp & any;
  constructor(app) {
    this.app = app;
  }

  async query({ hash, fields } = {} as any) {
    const {
      app: { service },
    } = this as ScanCtx;

    if (!hash) {
      return null;
    }

    const detail = Boolean(lodash.intersection(fields, DETAIL_FIELDS).length);
    let block;
    if (hash?.length === 66) {
      block = await service.conflux.getBlockByHash(hash, detail);
    } else {
      try {
        block = await service.conflux.getBlockByEpochNumber(hash, detail);
      } catch (e) {
        if (!e.message?.startsWith('Invalid params: expected a numbers with less than largest epoch number')) {
          throw e;
        }
      }
    }
    if (!block) {
      return null;
    }

    let risk;
    if (lodash.includes(fields, 'risk') && hash?.length === 66) {
      // not mined tx might not have blockHash
      risk = await service.conflux.getConfirmationRiskByHash(hash).catch(() => null);
    }

    let pivotInfo = {};
    if (lodash.intersection(fields, PIVOT_FIELDS).length) {
      pivotInfo = await this._getPivot(block);
    }

    let detailInfo = await this._getDetail(block);

    let reward = {};
    let rewardDetail = {}
    if (lodash.intersection(fields, REWARD_FIELDS).length) {
      reward = await this._getReward(block);
      reward = lodash.pick(reward, REWARD_FIELDS);
      rewardDetail['baseReward'] = reward['baseReward']
      rewardDetail['txFee'] = reward['txFee']
      rewardDetail['storageCollateralInterest'] = reward['totalReward'] - rewardDetail['baseReward'] - rewardDetail['txFee']
    }

    let baseFeePerGasRef;
    while(block.epochNumber > 0) {
      const refEpoch = StatApp.isEVM ? block.epochNumber - (block.epochNumber % 5) : block.epochNumber
      const preEpoch = StatApp.isEVM ? refEpoch - 5 : refEpoch - 1
      if (refEpoch < 0 || preEpoch < 0) {
        break;
      }
      const [refBlk, preBlk] = await Promise.all([
        StatApp.isEVM ? service.conflux.getBlockByEpochNumber(refEpoch, true) : block,
        service.conflux.getBlockByEpochNumber(preEpoch, false),
      ])
      if (!refBlk || !preBlk) {
        break;
      }
      const refBlkDetail: any = StatApp.isEVM ? await this._getDetail(refBlk) : detailInfo
      const prePivot = lodash.pick(preBlk, ['height', 'baseFeePerGas'])
      baseFeePerGasRef = {
        height: refEpoch,
        gasUsed: refBlkDetail.gasUsed,
        prePivot
      }
    }
    const {coreBlock, gasLimit} = await loadEvmBlockSpec(block.epochNumber, detailInfo["gasLimit"] ?? block.gasLimit);
    if (gasLimit) {
      detailInfo['gasLimit'] = gasLimit;
    }
    const blkExt = await FullBlockExt.sequelize.query(`select * from full_block_ext where epoch = ? and position = 
         (select position from full_block where hash = ?)`,
        { type: QueryTypes.SELECT, replacements: [block.epochNumber, block.hash]})
        .then(arr => {return arr?.length ? arr[0] : null});
    let extra = blkExt?.extra ? JSON.parse(blkExt.extra) : undefined
    lodash.assign(block, {burntGasFee: extra?.burntFee, coreBlock})
    rewardDetail['burntGasFee'] = extra?.burntFee

    const epoch = await service.epoch.query({ epochNumber: block.epochNumber }) || {};
    return lodash.defaults(detailInfo, block, pivotInfo, reward, {
      risk,
      rewardDetail,
      baseFeePerGasRef,
      syncTimestamp: epoch.timestamp,
      transactionCount: block.transactions.length,
    });
  }

  async _getDetail({ hash, transactions }) {
    let newTransactionCount = 0;
    let gasPriceCount = BigInt(0);
    // let gasUsed = BigInt(0);
    let crossSpaceTransactionCount = 0;
    lodash.forEach(transactions, (transaction) => {
      if (transaction.blockHash === hash) {
        newTransactionCount += 1;
        gasPriceCount += BigInt(transaction.gasPrice);
        // gasUsed += BigInt(transaction.gas)
      }
      if(!transaction.gasPrice){
        crossSpaceTransactionCount++
      }
    });

    const result = {
      newTransactionCount,
      avgGasPrice: newTransactionCount ? BigFixed(gasPriceCount).div(newTransactionCount) : BigFixed(0),
    };
    // if(NoCoreSpace) {
      // For non-cfx chains, use block's gasLIMIT and gasUsed
    // } else {
      // result['gasUsed'] = gasUsed;
      // if (!StatApp.isEVM) {
      //   Some calculations are performed when syncing blocks
        // const block = await FullBlock.findOne({where: {hash}})
        // block && (result['gasLimit'] = block['gasLimit'])
      // }
    // }
    StatApp.isEVM && (result['crossSpaceTransactionCount'] = crossSpaceTransactionCount)

    return result;
  }

  async _getPivot({ hash, epochNumber }) {
    const {
      app: { service },
    } = this;

    if (!Number.isInteger(epochNumber)) {
      return {};
    }

    const blockHashArray = await service.conflux.getBlocksByEpochNumber(epochNumber);
    const blockIndex = blockHashArray.indexOf(hash);

    return {
      blockIndex: blockIndex === -1 ? undefined : blockIndex, // might not be found,
      pivotHash: lodash.last(blockHashArray),
    };
  }

  async _getReward({ hash, epochNumber }) {
    const {
      app: { service },
    } = this;

    if (!Number.isInteger(epochNumber)) {
      return {};
    }

    const array = await service.conflux.getBlockRewardInfo(epochNumber).catch((err) => {
      // eslint-disable-next-line no-empty
      if (err.message.includes('Invalid parameters: epoch')) {
      } else {
        console.log(' block service, getBlockRewardInfo fail:', err);
      }
      return [];
    });
    return lodash.keyBy(array, 'blockHash')[hash] || {};
  }

  // --------------------------------------------------------------------------
  async count(options = {}) {
    const {
      app: { ttlMap },
    } = this;

    const { total } = await ttlMap.cache(`BlockService.count(${JSON.stringify(options)})`,
      () => this.countAndList({ ...options, limit: 0 }),
      { ttl: 5 * 1000 },
    );
    return total;
  }

  async countAndList({ fields, ...options } = {} as any) {
    const {
      app: { service, type },
    } = this as ScanCtx;

    let result;
    if (options.referredBy !== undefined) {
      result = await this._countAndListRefereeByHash(options);
    } else {
        result = await service.fullBlock.listBlock(options);
        return result;
    }

    let list = await limitMap(result.list,
      async (object) => {
        const block = await this.query({ hash: object.hash, fields });
        return lodash.defaults({}, block, object);
      },
      { limit: 100 },
    );

    if (options.miner !== undefined) {
      const base32 = type.checksumAddress(options.miner);
      list = list.filter((block) => block.miner === base32) || [];
    }
    if (options.epochNumber !== undefined) {
      list = list.filter((block) => block.epochNumber === options.epochNumber);
    }
    if (options.minTimestamp !== undefined) {
      list = list.filter((block) => block.timestamp >= options.minTimestamp);
    }
    if (options.maxTimestamp !== undefined) {
      list = list.filter((block) => block.timestamp <= options.maxTimestamp);
    }

    list = options.reverse ? [...list].reverse() : list;
    return {
      total: list.length,
      list: list.slice(options.skip, options.skip + options.limit),
    };
  }

  async _countAndListRefereeByHash({
    referredBy,
    skip = 0,
    limit = Infinity,
    reverse = false,
  } = {} as any) {
    let { refereeHashes: list = [] } = await this.query({ hash: referredBy }) || {};
    const total = list.length;

    list = reverse ? [...list].reverse() : list;
    list = list.slice(skip, skip + limit);
    list = await Promise.all(list.map((hash) => ({ hash })));

    return { total, list };
  }
}

async function loadEvmBlockSpec(epochNumber: number, gasLimitBase: number) {
  let coreBlock = 0;
  let gasLimit = undefined;
  if (NoCoreSpace) {
    // the other chains go here.
  } else if (StatApp.isEVM) {
    // E Space
    // rpc returns accurate value now (near 2024.12.30)
    gasLimit = BigInt(gasLimitBase);
    coreBlock = gasLimit == BigInt(0) ? 1 : 0;
  } else {
    // core space, it was calculated when syncing blocks, and used in fn _getDetail
  }
  return {coreBlock, gasLimit};
}
