const {noVerboseAddr} = require("../../stat/dist/service/common/utils")
const {patchPocketAddress} = require("../../stat/dist/model/HexMap")

const lodash = require('lodash');
const { tracesInTree } = require('js-conflux-sdk/src/util/trace');
const { withoutCfxTransferType } = require('../../common/utils');

class ConfluxService {
  constructor(app) {
    this.app = app;
  }

  async _calculateTTL(
    epochNumber,
    defaultTTL = 5 * 1000,
    histogram = [
      [5, 5 * 1000],
      [10, 30 * 1000],
      [100, 60 * 1000],
      [1000, 5 * 60 * 1000],
      [10000, 60 * 1000],
      [Infinity, 5 * 1000],
    ],
  ) {
    const {
      app: { CONST },
    } = this;
    if (!epochNumber) {
      return defaultTTL;
    }
    const delta = await this.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_MINED).then(BigInt) - BigInt(epochNumber);
    for (const [bound, ttl] of histogram) {
      if (delta <= bound) {
        return ttl;
      }
    }
    return defaultTTL;
  }

  async _calculateIsSave(epochNumber) {
    const {
      app: { CONST },
    } = this;

    // FIXME: in javascript, `Boolean(null < 10) === true` !!!
    return Number.isInteger(epochNumber) && epochNumber < await this.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_CONFIRMED);
  }

  // ---------------------------------- address -------------------------------
  async getAccount(address, epochNumber) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getAccount(${address},${epochNumber})`,
      () => cfx.getAccount(address, epochNumber),
      { ttl: this._calculateTTL(epochNumber) },
    );
  }

  async getAdmin(address, epochNumber) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getAdmin(${address},${epochNumber})`,
      () => cfx.getAdmin(address, epochNumber),
      { ttl: this._calculateTTL(epochNumber) },
    );
  }

  async getSponsorInfo(address, epochNumber) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getSponsorInfo(${address},${epochNumber})`,
      () => cfx.getSponsorInfo(address, epochNumber),
      { ttl: this._calculateTTL(epochNumber, 60 * 1000) },
    );
  }

  async getCode(address, epochNumber) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getCode(${address},${epochNumber})`,
      () => cfx.getCode(address, epochNumber).catch(() => undefined),
      { ttl: (code) => (code ? 5 * 60 * 1000 : 60 * 1000) },
    );
  }

  async getToken(address, epochNumber) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getToken(${address},${epochNumber})`,
      () => cfx.getToken(address, epochNumber),
      { ttl: 60 * 60 * 1000 },
    );
  }

  async isToken(address, epochNumber) {
    const { name, symbol } = await this.getToken(address, epochNumber);
    return name !== undefined && symbol !== undefined;
  }

  async isCustodianToken(address, custodianAddress, epochNumber) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService_isCustodianToken(${address},${custodianAddress},${epochNumber})`,
      () => cfx.isCustodianToken(address, custodianAddress, epochNumber),
      { ttl: 60 * 60 * 1000 },
    );
  }

  async getTokenTotalSupply(address, epochNumber) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getTokenTotalSupply(${address},${epochNumber})`,
      () => cfx.getTokenTotalSupply(address, epochNumber),
      { ttl: 60 * 1000 },
    );
  }

  async getTokenAccountCount(address, epochNumber) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getTokenAccountCount(${address},${epochNumber})`,
      () => cfx.getTokenAccountCount(address, epochNumber),
      { ttl: 10 * 1000 },
    );
  }

  async getBalances(account, contracts, utilContract) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getTokenBalance(${account})`,
      () => cfx.getBalances(account, contracts, utilContract),
      { ttl: 10 * 1000 },
    );
  }

  async getTokenBalance(address, epochNumber) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getTokenBalance(${address},${epochNumber})`,
      () => cfx.getTokenBalance(address, epochNumber),
      { ttl: 10 * 1000 },
    );
  }

  // -------------------------------- epochNumber -----------------------------
  async getEpochNumber(epochLabel) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getEpochNumber(${epochLabel})`,
      () => cfx.getEpochNumber(epochLabel),
      { ttl: 1000 },
    );
  }

  async getEpochByEpochNumber(epochNumber) {
    const {
      app: { cfx, ttlMap/* , kvStore */ },
    } = this;

    return ttlMap.cache(`ConfluxService.getEpochByEpochNumber(${epochNumber})`,
      // () => kvStore.cache(`ConfluxService.getEpochByEpochNumber(${epochNumber})`,
      () => cfx.getEpochByEpochNumber(epochNumber),
      //   { isSave: this._calculateIsSave(epochNumber) },
      // ),
      { ttl: this._calculateTTL(epochNumber) },
    );
  }

  async getBlocksByEpochNumber(epochNumber) {
    const {
      app: { cfx, ttlMap/* , kvStore */ },
    } = this;

    return ttlMap.cache(`ConfluxService.getBlocksByEpochNumber(${epochNumber})`,
      // () => kvStore.cache(`ConfluxService.getBlocksByEpochNumber(${epochNumber})`,
      () => cfx.getBlocksByEpochNumber(epochNumber),
      //   { isSave: this._calculateIsSave(epochNumber) },
      // ),
      { ttl: this._calculateTTL(epochNumber) },
    );
  }

  async getBlockRewardInfo(epochNumber) {
    const {
      app: { cfx, ttlMap/* , kvStore */ },
    } = this;

    let result;
    try {
      result = ttlMap.cache(`ConfluxService.getBlockRewardInfo(${epochNumber})`,
        // () => kvStore.cache(`ConfluxService.getBlockRewardInfo(${epochNumber})`,
        () => cfx.getBlockRewardInfo(epochNumber),
        //   { isSave: this._calculateIsSave(epochNumber) },
        // ),
        { ttl: this._calculateTTL(epochNumber) },
      );
    } catch (err) {
      return [];
    }

    return result;
  }

  // ---------------------------------- block ---------------------------------
  async getBlockByEpochNumber(epochNumber, detail) {
    const {
      app: { CONST, cfx, ttlMap/* , kvStore */ },
    } = this;

    return ttlMap.cache(`ConfluxService.getBlockByEpochNumber(${epochNumber},${detail})`,
      async () => {
        let block = null;
        try {
          block = await cfx.getBlockByEpochNumber(epochNumber, detail);
        } catch (e) {
          if (!e.message?.startsWith('Invalid params: expected a numbers with less than largest epoch number')) {
            throw e;
          }
        }
        if (!block) {
          return block;
        }

        if (block.epochNumber === 0) {
          block.gasUsed = 0;
        }

        if (detail) {
          block.transactions.forEach((transaction) => {
            if (block.epochNumber === 0) {
              transaction.blockHash = block.hash;
              transaction.status = CONST.TX_STATUS.SUCCESS;
              transaction.transactionIndex = block.transactions.indexOf(transaction.hash); // must not be -1
              transaction.contractCreated = CONST.GENESIS_TX_TO_CONTRACT[transaction.hash] || null;
            }

            transaction.epochNumber = block.epochNumber;
          });
        }
        return block;
      },
      { ttl: (block) => this._calculateTTL(lodash.get(block, 'epochNumber')) },
    );
  }

  async getBlockByHash(blockHash, detail) {
    const {
      app: { CONST, cfx, ttlMap/* , kvStore */ },
    } = this;

    return ttlMap.cache(`ConfluxService.getBlockByHash(${blockHash},${detail})`,
      // () => kvStore.cache(`ConfluxService.getBlockByHash(${blockHash},${detail})`,
      async () => {
        const block = await cfx.getBlockByHash(blockHash, detail);
        if (!block) {
          return block;
        }

        if (block.epochNumber === 0) {
          block.gasUsed = 0;
        }

        if (detail) {
          block.transactions.forEach((transaction) => {
            if (block.epochNumber === 0) {
              transaction.blockHash = block.hash;
              transaction.status = CONST.TX_STATUS.SUCCESS;
              transaction.transactionIndex = block.transactions.indexOf(transaction.hash); // must not be -1
              transaction.contractCreated = CONST.GENESIS_TX_TO_CONTRACT[transaction.hash] || null;
            }

            transaction.epochNumber = block.epochNumber;
          });
        }
        return block;
      },
      //   { isSave: (block) => this._calculateIsSave(lodash.get(block, 'epochNumber')) },
      // ),
      { ttl: (block) => this._calculateTTL(lodash.get(block, 'epochNumber')) },
    );
  }

  async getConfirmationRiskByHash(blockHash) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getConfirmationRiskByHash(${blockHash})`,
      () => cfx.getConfirmationRiskByHash(blockHash),
      {
        ttl: (risk) => {
          if (risk <= 1e-8) {
            return 60 * 1000;
          }
          if (risk <= 1e-6) {
            return 30 * 1000;
          }
          if (risk <= 1e-4) {
            return 5 * 1000;
          }
          return 1000;
        },
      },
    );
  }

  // ------------------------------- transaction ------------------------------
  async getTransactionByHash(transactionHash) {
    const {
      app: { CONST, cfx, ttlMap/* , kvStore, logger */ },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionByHash(${transactionHash})`,
      // () => kvStore.cache(`ConfluxService.getTransactionByHash(${transactionHash})`,
      async () => {
        const transaction = await cfx.getTransactionByHash(transactionHash);
        if (transaction && transaction.blockHash) {
          const block = await this.getBlockByHash(transaction.blockHash);
          transaction.epochNumber = block.epochNumber; // for calculateTTL to cache

          if (transaction.epochNumber === 0) {
            transaction.blockHash = block.hash;
            transaction.status = CONST.TX_STATUS.SUCCESS;
            transaction.transactionIndex = block.transactions.indexOf(transaction.hash); // must not be -1
            transaction.contractCreated = CONST.GENESIS_TX_TO_CONTRACT[transaction.hash] || null;
          }
        }
        return transaction;
      },
      //   { isSave: (transaction) => this._calculateIsSave(lodash.get(transaction, 'epochNumber')) },
      // ),
      { ttl: (transaction) => this._calculateTTL(lodash.get(transaction, 'epochNumber')) },
    );
  }

  async getTransactionReceipt(transactionHash) {
    const {
      app: { CONST, cfx, ttlMap/* , kvStore */ },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionReceipt(${transactionHash})`,
      // () => kvStore.cache(`ConfluxService.getTransactionReceipt(${transactionHash})`,
      async () => {
        if (transactionHash in CONST.GENESIS_TX_TO_CONTRACT) {
          return { gasUsed: 0, gasFee: 0, txExecErrorMsg: null };
        }
        return cfx.getTransactionReceipt(transactionHash);
      },
      //   { isSave: (receipt) => this._calculateIsSave(lodash.get(receipt, 'epochNumber')) },
      // ),
      { ttl: (receipt) => this._calculateTTL(lodash.get(receipt, 'epochNumber')) },
    );
  }

  async getLogsByTransactionHash(transactionHash) {
    const { epochNumber, logs = [] } = await this.getTransactionReceipt(transactionHash) || {};

    return logs.map((log, transactionLogIndex) => ({
      epochNumber,
      transactionHash,
      transactionLogIndex,
      ...log,
    }));
  }

  async getTransactionERC20TransferArray(transactionHash) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionERC20TransferArray(${transactionHash})`,
      async () => {
        const eventLogArray = await this.getLogsByTransactionHash(transactionHash);
        return eventLogArray.map((eventLog) => cfx.decodeERC20Transfer(eventLog)).filter(Boolean);
      },
      { ttl: 5 * 1000 },
    );
  }

  async getTransactionERC721TransferArray(transactionHash) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionERC721TransferArray(${transactionHash})`,
      async () => {
        const eventLogArray = await this.getLogsByTransactionHash(transactionHash);
        return eventLogArray.map((eventLog) => cfx.decodeERC721Transfer(eventLog)).filter(Boolean);
      },
      { ttl: 5 * 1000 },
    );
  }

  async getTransactionERC777TransferArray(transactionHash) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionERC777TransferArray(${transactionHash})`,
      async () => {
        const eventLogArray = await this.getLogsByTransactionHash(transactionHash);
        return eventLogArray.map((eventLog) => cfx.decodeERC777Transfer(eventLog)).filter(Boolean);
      },
      { ttl: 5 * 1000 },
    );
  }

  async getTransactionERC1155TransferArray(transactionHash) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionERC1155TransferArray(${transactionHash})`,
      async () => {
        const eventLogArray = await this.getLogsByTransactionHash(transactionHash);
        return lodash.flatten(eventLogArray.map((eventLog) => cfx.decodeERC1155TransferArray(eventLog))).filter(Boolean);
      },
      { ttl: 5 * 1000 },
    );
  }

  // FIXME: not a good idea
  async getTransactionERCXXXTransferArray(transactionHash) {
    const {
      app: { CONST },
    } = this;

    const listERC20 = await this.getTransactionERC20TransferArray(transactionHash);
    listERC20.forEach((transfer) => {
      transfer.transferType = CONST.TRANSFER_TYPE.ERC20;
    });

    const listERC777 = await this.getTransactionERC777TransferArray(transactionHash);
    listERC777.forEach((transfer) => {
      transfer.transferType = CONST.TRANSFER_TYPE.ERC777;
    });

    const listERC721 = await this.getTransactionERC721TransferArray(transactionHash);
    listERC721.forEach((transfer) => {
      transfer.transferType = CONST.TRANSFER_TYPE.ERC721;
    });

    const listERC1155 = await this.getTransactionERC1155TransferArray(transactionHash);
    listERC1155.forEach((transfer) => {
      transfer.transferType = CONST.TRANSFER_TYPE.ERC1155;
    });

    const list = [...listERC20, ...listERC777, ...listERC721, ...listERC1155];
    lodash.forEach(list, item => item.transactionLogIndexDecimal = Number(item.transactionLogIndex));
    return lodash.orderBy(list, 'transactionLogIndexDecimal');
  }

  // ---------------------------------- trace ---------------------------------
  async getBlockTraceArray(blockHash) {
    const {
      app: { cfx, ttlMap/* , kvStore */ },
    } = this;

    return ttlMap.cache(`ConfluxService.getBlockTraceArray(${blockHash})`,
      // () => kvStore.cache(`ConfluxService.getBlockTraceArray(${blockHash})`,
      async () => {
        const blockTrace = await cfx.traceBlock(blockHash);
        if (!blockTrace) {
          return [];
        }

        const block = await this.getBlockByHash(blockHash, true);
        if (!block) {
          return [];
        }

        const array = [];
        lodash.zip(block.transactions, blockTrace.transactionTraces)
          .forEach(([transaction, transactionTraces], transactionIndex) => {
            transactionTraces.traces.forEach((trace, transactionTraceIndex) => {
              array.push({
                epochNumber: block.epochNumber,
                blockHash: block.hash,
                transactionHash: transaction.hash,
                transactionIndex,
                transactionTraceIndex,
                status: transaction.status,
                ...trace,
              });
            });
          });
        return array;
      },
      //   { isSave: (array) => this._calculateIsSave(lodash.get(array, [0, 'epochNumber'])) },
      // ),
      { ttl: (array) => this._calculateTTL(lodash.get(array, [0, 'epochNumber'])) },
    );
  }

  async getTransactionTraceArray(transactionHash) {
    const {
      app: { cfx },
    } = this;

    const transaction = await this.getTransactionByHash(transactionHash);
    if (!transaction || !transaction.blockHash) {
      return [];
    }

    const array = await this.getBlockTraceArray(transaction.blockHash);
    const object = lodash.groupBy(array, 'transactionHash');
    const traces = object[transaction.hash] || [];
    return cfx.matchTrace(traces, transaction);
  }

  async getTransactionCFXTransferArray(transactionHash, zeroValue = false) {
    const {
      app: { CONST },
    } = this;

    const traceArray = await this.getTransactionTraceArray(transactionHash);

    const array = [];
    for (const trace of traceArray) {
      const { callType } = trace.action;
      if (
        withoutCfxTransferType(callType)
      ) {
        // eslint-disable-next-line no-continue
        continue;
      }
      if (trace.status === CONST.TX_STATUS.SUCCESS
          && (zeroValue || trace.action.value)
          && (trace.type === CONST.TRACE_TYPE.CREATE
            || trace.type === CONST.TRACE_TYPE.CALL
            || trace.type === CONST.TRACE_TYPE.INTERNAL_TRANSFER_ACTION
            || trace.type === CONST.TRACE_TYPE.MINER_REWARD
          )// FIXME: only for trace without output
      ) {
        array.push({
          epochNumber: trace.epochNumber,
          transactionHash: trace.transactionHash,
          transactionTraceIndex: trace.transactionTraceIndex,
          from: trace.action.from,
          to: trace.action.to,
          value: trace.action.value,
          type: trace.type,
        });
      }
    }
    return array;
  }

  async getTransactionCFXTransferTree(transactionHash) {
    const {
      app: { cfx, error, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionTraceTree(${transactionHash})`,
      async () => {
        let traceArray;
        try {
          traceArray = await cfx.traceTransaction(transactionHash);
        } catch (err) {
          throw new error.ResponseDataParsingError(`fail to traceTransaction by sdk: ${err}`);
        }
        if (!traceArray || traceArray.length === 0) {
          return {};
        }
        const addressSet = new Set();
        traceArray.forEach((trace) => {
          const {fromPocket, toPocket, from, to} = trace.action;
          if (trace?.action?.init) trace.action.init = undefined;
          if (trace?.action?.input) trace.action.input = undefined;
          if (trace?.action?.from) {
            trace.action.from = patchPocketAddress(fromPocket, noVerboseAddr(trace.action.from), cfx.networkId)
            addressSet.add(trace.action.from);
          }
          if (trace?.action?.to) {
            trace.action.to = patchPocketAddress(toPocket, noVerboseAddr(trace.action.to),  cfx.networkId)
            addressSet.add(trace.action.to);
          }
          if (trace?.action?.addr) addressSet.add(trace.action.addr);
        });
        let result = {};
        try {
          result.traceTree = tracesInTree(traceArray);
          result.addressArray = [...addressSet];
        } catch (err) {
          /*return { code: 60002, message: `parse traces fail:${err}` };*/
          throw new error.ResponseDataParsingError(`fail to parse traces by sdk: ${err}`);
        }
        return result || {};
      },
      { ttl: 5 },
    );
  }
}

module.exports = ConfluxService;
