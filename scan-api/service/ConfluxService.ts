import {ScanApp, ScanCtx} from "./index";
import {fmtAddr, StatApp} from "../../stat/StatApp";
import {safeAddErrorLog} from "../../stat/monitor/ErrorMonitor";
import {format} from "js-conflux-sdk";
import {CONST} from "../../stat/service/common/constant";
import {getAddrIdArray} from "../../stat/model/HexMap";
import {fillMethodInfo} from "../../stat/service/contract/contractTool";
import {ContractImpl} from "../../stat/model/ContractImpl";
import {QueryTypes} from "sequelize";

const _ = require('lodash');
const { tracesInTree } = require('js-conflux-sdk/src/util/trace');
const { withoutCfxTransferType } = require('../../common/utils');

export class ConfluxService {
  app: ScanApp & any;
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
    // FIXME: in javascript, `Boolean(null < 10) === true` !!!
    return Number.isInteger(epochNumber) && epochNumber < await this.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_CONFIRMED);
  }

  // ---------------------------------- address -------------------------------
  async getAccount(address, epochNumber=undefined) {
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
      () => cfx.getCode(address, epochNumber).catch((e) => {
        safeAddErrorLog('cfx-service',`get-code-${address}`, e);
        console.log(`${__filename} failed to get code of ${address} at epoch ${epochNumber} .`, e);
      }),
      { ttl: (code) => (code ? 5 * 60 * 1000 : 60 * 1000) },
    );
  }


  async isToken(address, epochNumber = undefined) {
    const {
      app: { tokenTool },
    } = this as ScanCtx;

    const { name, symbol } = await tokenTool.getToken(address, epochNumber);
    return name !== undefined && symbol !== undefined;
  }

  async getBalances(account, contracts, utilContract) {
    const {
      app: { ttlMap, tokenTool },
    } = this as ScanCtx;

    return ttlMap.cache(`ConfluxService.getBalances(${account})`,
      () => tokenTool.getBalances(account, contracts, utilContract),
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
      app: { ttlMap, tokenTool },
    } = this as ScanCtx;

    return ttlMap.cache(`ConfluxService.get-Epoch-By-EpochNumber(${epochNumber})`,
      () => tokenTool.getEpochByEpochNumber(epochNumber),
      { ttl: this._calculateTTL(epochNumber) },
    );
  }

  async getBlocksByEpochNumber(epochNumber) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getBlocksByEpochNumber(${epochNumber})`,
      () => cfx.getBlocksByEpochNumber(epochNumber),
      { ttl: this._calculateTTL(epochNumber) },
    );
  }

  async getBlockRewardInfo(epochNumber) {
    const {
      app: { cfx, ttlMap },
    } = this;

    let result;
    try {
      result = ttlMap.cache(`ConfluxService.getBlockRewardInfo(${epochNumber})`,
        () => cfx.getBlockRewardInfo(epochNumber),
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
      app: { cfx, ttlMap },
    } = this as ScanCtx;

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
              transaction.contractCreated = this.getGenesisContract(transaction.hash)
            }

            transaction.epochNumber = block.epochNumber;
          });
        }
        return block;
      },
      { ttl: (block) => this._calculateTTL(_.get(block, 'epochNumber')) },
    );
  }

  async getBlockByHash(blockHash:string, detail=false) {
    const {
      app: { cfx, ttlMap },
    } = this as ScanCtx;

    return ttlMap.cache(`ConfluxService.getBlockByHash(${blockHash},${detail})`,
      async () => {
        const block = await cfx.getBlockByHash(blockHash, detail);
        if (!block) {
          return block;
        }

        if (block.epochNumber === 0) {
          block.gasUsed = 0;
        }

        if (detail) {
          (block.transactions as any[]).forEach((transaction) => {
            if (block.epochNumber === 0) {
              transaction.blockHash = block.hash;
              transaction.status = CONST.TX_STATUS.SUCCESS;
              transaction.transactionIndex = block.transactions.indexOf(transaction.hash); // must not be -1
              transaction.contractCreated = this.getGenesisContract(transaction.hash)
            }

            transaction.epochNumber = block.epochNumber;
          });
        }
        return block;
      },
      { ttl: (block) => this._calculateTTL(_.get(block, 'epochNumber')) },
    );
  }

  async getConfirmationRiskByHash(blockHash: string) {
    if (!blockHash) {
      return null;
    }
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
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionByHash(${transactionHash})`,
      async () => {
        const transaction = await cfx.getTransactionByHash(transactionHash);
        if (transaction && transaction.blockHash) {
          const block = await this.getBlockByHash(transaction.blockHash);
          transaction.epochNumber = block?.epochNumber; // for calculateTTL to cache

          if (transaction.epochNumber === 0) {
            transaction.blockHash = block?.hash;
            transaction.status = CONST.TX_STATUS.SUCCESS;
            transaction.transactionIndex = block?.transactions.indexOf(transaction.hash); // must not be -1
            transaction.contractCreated = this.getGenesisContract(transaction.hash)
          }
        }
        return transaction;
      },
      { ttl: (transaction) => this._calculateTTL(_.get(transaction, 'epochNumber')) },
    );
  }

  getGenesisContract(txHash) {
    const contract = CONST.GENESIS_TX_CONTRACT_MAP[txHash]
    if(!contract) {
      return null
    }

    return format.address(contract, StatApp.networkId)
  }

  async getTransactionReceipt(transactionHash) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionReceipt(${transactionHash})`,
      async () => {
        if(Object.keys(CONST.GENESIS_TX_CONTRACT_MAP).includes(transactionHash)){
          return { gasUsed: 0, gasFee: 0, txExecErrorMsg: null };
        }
        return cfx.getTransactionReceipt(transactionHash);
      },
      { ttl: (receipt) => this._calculateTTL(_.get(receipt, 'epochNumber')) },
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
      app: { ttlMap, tokenTool },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionERC20TransferArray(${transactionHash})`,
      async () => {
        const eventLogArray = await this.getLogsByTransactionHash(transactionHash);
        return eventLogArray.map((eventLog) => tokenTool.decodeERC20TransferPlus(eventLog)).filter(Boolean);
      },
      { ttl: 5 * 1000 },
    );
  }

  async getTransactionERC721TransferArray(transactionHash) {
    const {
      app: { ttlMap, tokenTool },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionERC721TransferArray(${transactionHash})`,
      async () => {
        const eventLogArray = await this.getLogsByTransactionHash(transactionHash);
        return eventLogArray.map((eventLog) => tokenTool.decodeERC721Transfer(eventLog)).filter(Boolean);
      },
      { ttl: 5 * 1000 },
    );
  }

  async getTransactionERC777TransferArray(transactionHash) {
    const {
      app: { ttlMap, tokenTool },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionERC777TransferArray(${transactionHash})`,
      async () => {
        const eventLogArray = await this.getLogsByTransactionHash(transactionHash);
        return eventLogArray.map((eventLog) => tokenTool.decodeERC777Transfer(eventLog)).filter(Boolean);
      },
      { ttl: 5 * 1000 },
    );
  }

  async getTransactionERC1155TransferArray(transactionHash) {
    const {
      app: { ttlMap, tokenTool },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionERC1155TransferArray(${transactionHash})`,
      async () => {
        const eventLogArray = await this.getLogsByTransactionHash(transactionHash);
        return _.flatten(eventLogArray.map((eventLog) => tokenTool.decodeERC1155TransferArrayPlus(eventLog))).filter(Boolean);
      },
      { ttl: 5 * 1000 },
    );
  }

  async getTransactionTokenTransferArray(transactionHash) {
    const {
      app: { ttlMap, tokenTool },
    } = this;

    return ttlMap.cache(`ConfluxService.getTransactionTokenTransferArray(${transactionHash})`,
      async () => {
        const logs = await this.getLogsByTransactionHash(transactionHash);
        const tokenTransfers = [];
        for (const log of logs) {
          let transfer;
          if ((transfer = tokenTool.decodeERC20TransferPlus(log, false))) {
            tokenTransfers.push(_.assign(transfer, {transferType: CONST.TRANSFER_TYPE.ERC20}))
          } else if ((transfer = tokenTool.decodeERC721Transfer(log, false))) {
            tokenTransfers.push(_.assign(transfer, {transferType: CONST.TRANSFER_TYPE.ERC721}));
          } else if ((transfer = tokenTool.decodeERC1155TransferArrayPlus(log)) && transfer.length) {
            transfer.forEach(item=>{
              tokenTransfers.push(_.assign(item, {transferType: CONST.TRANSFER_TYPE.ERC1155}));
            })
          }
        }
        tokenTransfers.forEach(item => _.assign(item, {transactionLogIndex: Number(item.transactionLogIndex)}));
        return tokenTransfers;
      },
      { ttl: 5 * 1000 },
    );
  }

  // FIXME: not a good idea
  async getTransactionERCXXXTransferArray(transactionHash) {
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
    _.forEach(list, item => item.transactionLogIndexDecimal = Number(item.transactionLogIndex));
    return _.orderBy(list, 'transactionLogIndexDecimal');
  }

  // ---------------------------------- trace ---------------------------------
  async getBlockTraceArray(blockHash) {
    const {
      app: { cfx, ttlMap },
    } = this;

    return ttlMap.cache(`ConfluxService.getBlockTraceArray(${blockHash})`,
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
        _.zip(block.transactions, blockTrace.transactionTraces)
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
      { ttl: (array) => this._calculateTTL(_.get(array, [0, 'epochNumber'])) },
    );
  }

  async getTransactionTraceArray(transactionHash) {
    const {
      app: { tokenTool },
    } = this;

    const transaction = await this.getTransactionByHash(transactionHash);
    if (!transaction || !transaction.blockHash) {
      return [];
    }

    const array = await this.getBlockTraceArray(transaction.blockHash);
    const object = _.groupBy(array, 'transactionHash');
    const traces = object[transaction.hash] || [];
    return tokenTool.matchTrace(traces, transaction);
  }

  async getTransactionCFXTransferArray(transactionHash, zeroValue = false) {
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

  async getTransactionTrace(transactionHash: string, convertTree?: boolean) {
    const {
      app: {cfx, error, ttlMap},
    } = this;

    if (this.app.config?.traceNotAvailable) {
      return {};
    }

    return ttlMap.cache(`ConfluxService.getTransactionTrace(${transactionHash})`,
      async () => {
        let traceArray;
        try {
          traceArray = await cfx.traceTransaction(transactionHash);
        } catch (err) {
          throw new error.ResponseDataParsingError(`Failed to get traceTransaction by sdk: ${err}`);
        }

        if (!traceArray || traceArray.length === 0) {
          return {};
        }

        const addressSet = new Set();
        const toAddressSet = new Set();
        const methodList: { index: number; to: string; method: string; methodId?: string;}[] = [];

        traceArray.forEach((trace: any, index: number) => {
          const {from, to, init, input, addr} = trace.action;
          if (init) {
            trace.action.init = undefined;
          }
          if (input) {
            if(input.length >= 10 && to) {
              methodList.push({index, to, method: input.substring(0, 10)});
            }
          }
          if (from) {
            trace.action.from = fmtAddr(from, cfx.networkId);
            addressSet.add(from);
          }
          if (to) {
            trace.action.to = fmtAddr(to, cfx.networkId);
            addressSet.add(to);
            toAddressSet.add(to)
          }
          if (addr) {
            trace.action.addr = fmtAddr(addr, cfx.networkId);
            addressSet.add(addr);
          }
        });

        const methodMap = {};
        if (methodList?.length) {
          const ids = await getAddrIdArray(methodList.map(item => item.to));
          await fillMethodInfo(methodList, ids, true, true);
          methodList.forEach(({to, method, methodId}) => {
            methodMap[methodId] ||= {};
            methodMap[methodId][fmtAddr(to, cfx.networkId)] = method;
          });
        }

        const proxyMap = {};
        if (toAddressSet.size) {
          const impls: any[] = await ContractImpl.sequelize.query(`
            select concat('0x', h.hex) as hex, c.proxyType from 
            (
              select id, hex 
              from hex40 
              where hex in (${[...toAddressSet].map(() => "?").join(",")})
            ) h
            left join contract_impl c on h.id = c.cid
          `, {
            type: QueryTypes.SELECT,
            replacements: [...toAddressSet].map(item => format.hexAddress(item).substr(2))
          }) || [];
          impls
            .filter(item => Boolean(item.proxyType))
            .forEach(item =>
              proxyMap[fmtAddr(item.hex, cfx.networkId)] =
                item.proxyType === CONST.PROXY_PATTERN.PROXY ? "Proxy" : "BeaconProxy"
            );
        }

        let result = {} as any;
        try {
          if (convertTree) {
            result.traceTree = tracesInTree(traceArray);
          } else {
            result.traceArray = traceArray;
          }
          result.addressArray = [...addressSet];
          result.proxyMap = proxyMap;
          result.methodMap = methodMap;
        } catch (err) {
          throw new error.ResponseDataParsingError(`Failed to parse traces by sdk: ${err}`);
        }

        return result || {};
      },
      {ttl: 5},
    );
  }
}

