const lodash = require('lodash');
const { Conflux } = require('js-conflux-sdk');
const NodeCache = require('node-cache');
/*const { isCustodianToken } = require('../stat/dist/service/tool/TokenTool');*/
const { patchHttpProvider } = require('../stat/dist/service/common/utils');
const tool = require('./tool');
const abi = require('./abi');
const CONST = require('./const');

// ----------------------------------------------------------------------------
const dbCache = new NodeCache();
const cacheTtl = 60 * 50; // 50 minutes
// ----------------------------------------------------------------------------
class ConfluxSDK extends Conflux {
  constructor(config = {}) {
    super(config);
    patchHttpProvider(this, config, 'common-conflux-sdk');
    this.contract = this.Contract({ abi });
  }

  /*async getEpochByEpochNumber(epochNumber) {
    const now = Math.floor(Date.now() / 1000);
    const pivotBlock = await this.getBlockByEpochNumber(epochNumber);

    return {
      epochNumber,
      pivotHash: pivotBlock.hash,
      parentHash: pivotBlock.parentHash,
      timestamp: lodash.min([pivotBlock.timestamp, now]), // XXX: for filter negative timestamp
    };
  }

  async getToken(address, epochNumber) {
    return tool.awaitObject({
      address,
      name: this.contract.name()
        .call({ to: address }, epochNumber)
        .catch(() => undefined),
      symbol: this.contract.symbol()
        .call({ to: address }, epochNumber)
        .catch(() => undefined),
      decimals: this.contract.decimals()
        .call({ to: address }, epochNumber)
        .then(Number)
        .catch(() => undefined),
      granularity: this.contract.granularity()
        .call({ to: address }, epochNumber)
        .then(Number)
        .catch(() => undefined),
    }).then((obj) => {
      dbCache.set(address, obj, cacheTtl);
      return obj;
    });
  }

  async getTokenTotalSupply(address, epochNumber) {
    const key = `${address}_getTokenTotalSupply`;
    const cache = dbCache.get(key);
    if (cache !== null && cache !== undefined) {
      return cache;
    }
    return this.contract.totalSupply()
      .call({ to: address }, epochNumber)
      .then(BigInt)
      .catch((err) => { return this.cacheErrorResult(err, key, 0); });
  }

  cacheErrorResult(err, key, value) {
    const msg = err.message || '';
    if (msg.includes('Transaction reverted') || msg.includes('Transaction execution failed')) {
      // that contract doesnt have the method, do not call again.
      dbCache.set(key, value);
    }
    return undefined;
  }

  async getTokenAccountCount(address, epochNumber) {
    const key = `${address}_getTokenAccountCount`;
    const cache = dbCache.get(key);
    if (cache !== null && cache !== undefined) {
      return cache;
    }
    return this.contract.accountCount()
      .call({ to: address }, epochNumber)
      .then(Number)
      .catch((err) => { return this.cacheErrorResult(err, key, 0); });
  }

  async isCustodianToken(address) {
    return isCustodianToken(address); // from redis
  }

  async getBalances(account, contracts, utilContract) {
    if (utilContract === undefined) {
      console.log('util contract not set.');
      return [];
    }
    return this.contract.getBalances(account, contracts)
      .call({ to: utilContract })
      .then((arr) => arr.map(BigInt))
      .catch((err) => {
        console.log('params:', account, contracts, utilContract);
        console.log(`get balances from util contract fail: ${err}`);
        return [];
      });
  }

  async getTokenBalance(address, accountAddress, epochNumber) {
    return this.contract.balanceOf(accountAddress)
      .call({ to: address }, epochNumber)
      .then(BigInt)
      .catch(() => undefined);
  }*/

  // --------------------------------------------------------------------------
  /*sendAnnounceTransaction(array, options = {}) {
    return this.contract.announce(array)
      .sendTransaction(options)
      .executed();
  }*/

  // --------------------------------------------------------------------------
  /*decodeERC20Transfer(eventLog = {}) {
    try {
      const tuple = this.contract.Transfer.decodeLog(eventLog);
      return { ...eventLog, ...tuple.toObject() };
    } catch (e) {
      // pass
    }

    return undefined;
  }

  decodeERC721Transfer(eventLog = {}) {
    const { topics = [], data = '0x' } = eventLog;

    // ERC721: Transfer(address indexed from, address indexed to, uint256 indexed value)
    if (topics[0] === this.contract.Transfer.signature && topics.length === 4 && data.length === 2) {
      return {
        ...eventLog,
        from: `0x${topics[1].slice(-40)}`,
        to: `0x${topics[2].slice(-40)}`,
        tokenId: BigInt(topics[3]),
      };
    }

    return undefined;
  }

  decodeERC777Transfer(eventLog = {}) {
    try {
      const tuple = this.contract.Sent.decodeLog(eventLog);
      return { ...eventLog, ...tuple.toObject() };
    } catch (e) {
      // pass
    }

    return undefined;
  }

  decodeERC1155TransferArray(eventLog = {}) {
    try {
      const tuple = this.contract.TransferBatch.decodeLog(eventLog);
      return lodash.zip(tuple.tokenIdArray, tuple.valueArray)
        .map(([tokenId, value], batchIndex) => ({ ...eventLog, ...tuple.toObject(), tokenId, value, batchIndex }))
        .filter((each) => each.tokenId !== undefined && each.value !== undefined);
    } catch (e) {
      // pass
    }

    try {
      const tuple = this.contract.TransferSingle.decodeLog(eventLog);
      return [{ ...eventLog, ...tuple.toObject(), batchIndex: 0 }];
    } catch (e) {
      // pass
    }

    return [];
  }

  matchTrace(transactionTraceArray, transaction) {
    if (!transactionTraceArray.length) {
      return [];
    }

    const stack = [];
    // eslint-disable-next-line no-plusplus
    for (let i = 0; i < transactionTraceArray.length; i++) {
      const nextTrace = transactionTraceArray[i];
      if (nextTrace.type !== CONST.TRACE_TYPE.CREATE && nextTrace.type !== CONST.TRACE_TYPE.CREATE_RESULT) {
        // eslint-disable-next-line no-continue
        continue;
      }
      if (nextTrace.type === CONST.TRACE_TYPE.CREATE) {
        stack.push(i);
      }
      if (nextTrace.type === CONST.TRACE_TYPE.CREATE_RESULT) {
        const creatTraceIndex = stack.pop();
        transactionTraceArray[creatTraceIndex].action.to = nextTrace.action.addr;
        transactionTraceArray[creatTraceIndex].action.outcome = nextTrace.action.outcome;
      }
    }
    if (stack.length > 0) {
      const creatTraceIndex = stack.pop();
      transactionTraceArray[creatTraceIndex].action.to = transaction.contractCreated;
    }
    return transactionTraceArray;
  }*/
}

module.exports = ConfluxSDK;
