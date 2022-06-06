const lodash = require('lodash');
const limitMap = require('limit-map');
const {fetchEnsMap} = require("../../stat/dist/service/ens/EnsService");
// const { KV, KEY_TX_QUERY_RDB_SWITCH } = require('../../stat/dist/model/KV');

const RECEIPT_FIELDS = [
  'gasCoveredBySponsor',
  'gasFee',
  'gasUsed',
  'stateRoot',
  'storageCollateralized',
  'storageCoveredBySponsor',
  'storageReleased',
  'txExecErrorMsg',
];

class TransactionService {
  constructor(app) {
    this.app = app;
  }

  async query({ hash, fields, aggregate }) {
    const {
      app: { service },
    } = this;

    if (!hash) {
      return null;
    }

    const transaction = await service.conflux.getTransactionByHash(hash);
    if (!transaction) {
      return null;
    }

    let risk;
    if (lodash.includes(fields, 'risk')) {
      // not mined tx might not have blockHash
      risk = await service.conflux.getConfirmationRiskByHash(transaction.blockHash).catch(() => null);
    }

    let receipt = {};
    if (lodash.intersection(fields, RECEIPT_FIELDS).length) {
      // old tx might not have receipt
      receipt = await service.conflux.getTransactionReceipt(hash).catch(() => undefined) || {};
      receipt = lodash.pick(receipt, RECEIPT_FIELDS);
    }

    // XXX: transaction.epochNumber come from `service.conflux.getTransactionByHash`
    const epoch = await service.epoch.query({ epochNumber: transaction.epochNumber }) || {};
    return lodash.defaults({ aggregate }, transaction, receipt, {
      risk,
      timestamp: epoch.timestamp,
      syncTimestamp: epoch.timestamp,
    });
  }

  // --------------------------------------------------------------------------
  async count(options = {}) {
    const {
      app: { ttlMap },
    } = this;

    const { total } = await ttlMap.cache(`TransactionService.count(${JSON.stringify(options)})`,
      () => this.countAndList({ ...options, limit: 0 }),
      { ttl: 5 * 1000 },
    );
    return total;
  }

  async countAndList({ fields, ...options } = {}) {
    const {
      app: { service, syncSDK, tool, logger },
    } = this;

    let result;
    if (options.blockHash !== undefined) {
      tool.checkExist(options, {
        blockHash: true, accountAddress: false, txType: false, status: false,
        minEpochNumber: false, maxEpochNumber: false, minTimestamp: false, maxTimestamp: false,
      });

      result = await this._countAndListByBlockHash(options);
    } else {
/*      const rdbSwitch = await KV.getSwitch(KEY_TX_QUERY_RDB_SWITCH);
      logger.info({ src: 'fullTXquery------------', rdbSwitch: JSON.stringify(rdbSwitch) });
      if (rdbSwitch) {*/
        result = await service.fullBlock.listTransaction(options);
        result.ensInfo = await fetchEnsMap(result.list,'from','to')
        return result;
       /* logger.info({ src: 'fullTXquery------------', result: JSON.stringify(result) });
        return lodash.defaults({ rdb: rdbSwitch }, result);
      }
      result = await syncSDK.countAndListTransaction(options);*/
    }

    result.list = await limitMap(result.list,
      async (object) => {
        const transaction = await this.query({ hash: object.hash, fields });
        return lodash.defaults({}, transaction, object);
      },
      { limit: 100 },
    );
    result.ensInfo = await fetchEnsMap(result.list,'from','to')

    return result;
  }

  async _countAndListByBlockHash({
    blockHash,
    skip = 0,
    limit = Infinity,
    reverse = false,
  } = {}) {
    const {
      app: { service },
    } = this;

    const block = await service.conflux.getBlockByHash(blockHash, true);
    let list = lodash.get(block, 'transactions', []);
    list = reverse ? [...list].reverse() : list;
    return {
      total: list.length,
      list: list.slice(skip, skip + limit),
    };
  }
}

module.exports = TransactionService;
