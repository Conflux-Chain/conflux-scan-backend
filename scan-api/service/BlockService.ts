import {ScanApp} from "./index";
import {QueryTypes} from "sequelize";
import {queryEvmBlockCountInEachEpoch} from "../../stat/service/FullBlockQuery";
import {NoCoreSpace} from "../../stat/config/StatConfig";
import {CONST} from "../../stat/service/common/constant";

const lodash = require('lodash');
const limitMap = require('limit-map');
const BigFixed = require('bigfixed');
const {StatApp} = require("../../stat/StatApp");
const {FullBlock, FullBlockExt} = require( "../../stat/model/FullBlock")

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
    } = this;

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

    let detailInfo = {};
    if (lodash.intersection(fields, DETAIL_FIELDS).length) {
      detailInfo = await this._getDetail(block);
    }

    let reward = {};
    let rewardDetail = {}
    if (lodash.intersection(fields, REWARD_FIELDS).length) {
      reward = await this._getReward(block);
      reward = lodash.pick(reward, REWARD_FIELDS);
      rewardDetail['baseReward'] = reward['baseReward']
      rewardDetail['txFee'] = reward['txFee']
      rewardDetail['storageCollateralInterest'] = reward['totalReward'] - rewardDetail['baseReward'] - rewardDetail['txFee']
    }

    let baseFeePerGasRef
    if(block.epochNumber > 0) {
      const refEpoch = StatApp.isEVM ? block.epochNumber - (block.epochNumber % 5) : block.epochNumber
      const preEpoch = StatApp.isEVM ? refEpoch - 5 : refEpoch - 1
      const [refBlk, preBlk] = await Promise.all([
        StatApp.isEVM ? service.conflux.getBlockByEpochNumber(refEpoch, true) : block,
        service.conflux.getBlockByEpochNumber(preEpoch, false),
      ])
      const refBlkDetail: any = StatApp.isEVM ? await this._getDetail(refBlk) : detailInfo
      const prePivot = lodash.pick(preBlk, ['height', 'baseFeePerGas'])
      baseFeePerGasRef = {
        height: refEpoch,
        gasUsed: refBlkDetail.gasUsed,
        prePivot
      }
    }
    const {coreBlock, gasLimit} = await loadEvmBlockSpec(block);
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
    const {
      app: { service },
    } = this;

    let newTransactionCount = 0;
    let gasPriceCount = BigInt(0);
    let gasUsed = BigInt(0);
    let crossSpaceTransactionCount = 0;
    lodash.forEach(transactions, (transaction) => {
      if (transaction.blockHash === hash) {
        newTransactionCount += 1;
        gasPriceCount += BigInt(transaction.gasPrice);
        gasUsed += BigInt(transaction.gas)
      }
      if(!transaction.gasPrice){
        crossSpaceTransactionCount++
      }
    });

    const result = {
      newTransactionCount,
      avgGasPrice: newTransactionCount ? BigFixed(gasPriceCount).div(newTransactionCount) : BigFixed(0),
    };
    if(NoCoreSpace) {
      // For non-cfx chains, use block's gasLIMIT and gasUsed
    } else {
      // Some calculations are performed when syncing blocks
      result['gasUsed'] = gasUsed;
      const block = await FullBlock.findOne({where:{hash}})
      block && (result['gasLimit'] = block['gasLimit'])
    }
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
      app: { service, syncSDK, tool, type },
    } = this;

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

async function loadEvmBlockSpec(block) {
  let coreBlock = 0;
  let gasLimit = undefined;
  if (NoCoreSpace) {
    // the other chains go here.
  } else if (StatApp.isEVM) {
    // E Space
    const map = await queryEvmBlockCountInEachEpoch(block.epochNumber, block.epochNumber);
    const evmBlockCount = map[block.epochNumber];
    coreBlock = evmBlockCount ? 0 : 1;
    const proportion = CONST.GAS_LIMIT_PROPORTION.evm;
    gasLimit = BigInt(block['gasLimit']) * BigInt(100 * evmBlockCount * proportion) / BigInt(100);
  } else {
    // core space, it was calculated when syncing blocks, and used in fn _getDetail
  }
  return {coreBlock, gasLimit};
}
