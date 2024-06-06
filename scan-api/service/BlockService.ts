import {ScanApp} from "./index";

const lodash = require('lodash');
const limitMap = require('limit-map');
const BigFixed = require('bigfixed');
const {StatApp} = require("../../stat/StatApp");

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
    if (lodash.intersection(fields, REWARD_FIELDS).length) {
      reward = await this._getReward(block);
      reward = lodash.pick(reward, REWARD_FIELDS);
    }

    const epoch = await service.epoch.query({ epochNumber: block.epochNumber }) || {};
    return lodash.defaults(detailInfo, block, pivotInfo, detailInfo, reward, {
      risk,
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
    result['gasUsed'] = gasUsed;
    if(StatApp.isEVM) {
      result['crossSpaceTransactionCount'] = crossSpaceTransactionCount;
      const blockList = await service.fullBlock.listBlock({blockHash: hash});
      if(blockList?.list?.length){
        result['gasLimit'] = blockList.list[0]['gasLimit']
      }
    }

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
      // const rdbSwitch = await KV.getSwitch(KEY_BLOCK_QUERY_RDB_SWITCH);
      // if (rdbSwitch) {
        result = service.fullBlock.listBlock(options);
        return result;
      // }
      // tool.checkExist(options, {
      //   epochNumber: false, referredBy: false, miner: undefined,
      //   minTimestamp: undefined, maxTimestamp: undefined, minEpochNumber: undefined, maxEpochNumber: undefined,
      // });
      // result = await syncSDK.countAndListBlock(options);
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

  async _countAndListByEpochNumber({
    epochNumber,
    skip = 0,
    limit = Infinity,
    reverse = false,
  } = {} as any) {
    const {
      app: { service },
    } = this;

    let list = await service.conflux.getBlocksByEpochNumber(epochNumber).catch(() => []);
    const total = list.length;

    list = reverse ? [...list].reverse() : list;
    list = list.slice(skip, skip + limit);
    list = await Promise.all(list.map((hash) => ({ hash })));

    return { total, list };
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

