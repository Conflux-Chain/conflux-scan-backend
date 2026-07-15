import {ScanApp, ScanCtx} from "./index";
import {fmtAddr, StatApp} from "../../stat/StatApp";
import {safeAddErrorLog} from "../../stat/monitor/ErrorMonitor";
import {format} from "js-conflux-sdk";
import {CONST} from "../../stat/service/common/constant";
import {getAddrIdArray, Hex40Map} from "../../stat/model/HexMap";
import {fillMethodInfo} from "../../stat/service/contract/contractTool";
import {ContractImpl} from "../../stat/model/ContractImpl";
import {Op, QueryTypes} from "sequelize";
import {TraceCreateContract} from "../../stat/model/TraceCreateContract";
import {AuthAction} from "../../stat/model/EIP7702model";
import {Errors} from "../../stat/service/common/LogicError";
import {formatBlockNumber, formatCallParams, sendRpc} from "../../stat/service/common/utils";

const crypto = require('crypto');
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

    return ttlMap.cache(`ConfluxService.getTransactionTrace(${transactionHash})_${convertTree ? 1 : 0}`,
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

          const addressSet = new Set<string>();
          const toAddressSet = new Set<string>();
          const methodList: { to: string; method: string; methodId?: string; }[] = [];
          traceArray.forEach((trace: any) => {
            const type = trace.type;
            const {from, to, init, input, addr, outcome, returnData} = trace.action;
            if (init) {
              trace.action.init = undefined;
            }
            if (type === CONST.TRACE_TYPE.CREATE_RESULT) {
              if (outcome === 'success') {
                if (returnData) {
                  trace.action.returnData = undefined;
                }
              }
            }
            if (from) {
              trace.action.from = fmtAddr(from, StatApp.networkId);
              addressSet.add(from);
            }
            if (to) {
              trace.action.to = fmtAddr(to, StatApp.networkId);
              addressSet.add(to);
              toAddressSet.add(to)
            }
            if (input && input.length >= 10 && to) {
              const {method, inputPrecompiled} = ConfluxService.getMethodInfo(input, to);
              methodList.push(method);
              if (inputPrecompiled) {
                trace.action.input = inputPrecompiled;
              }
            }
            if (addr) {
              trace.action.addr = fmtAddr(addr, StatApp.networkId);
              addressSet.add(addr);
            }
          });

          const {
            authMap,
            methodMap,
            proxyMap
          } = await this.getAdditionalInfo(transactionHash, toAddressSet, methodList);

          const result = {} as any;
          try {
            if (convertTree) {
              result.traceTree = tracesInTree(traceArray);
            } else {
              result.traceArray = traceArray;
            }
            result.authMap = authMap;
            result.methodMap = methodMap;
            result.proxyMap = proxyMap;
            Object.values(authMap).forEach((delegatedAddr: string) => addressSet.add(delegatedAddr));
            result.addressArray = [...addressSet];
          } catch (err) {
            throw new error.ResponseDataParsingError(`Failed to parse traces by sdk: ${err}`);
          }

          return result;
        },
        {ttl: 5},
    );
  }

  async getCallTrace(params, formatParams) {
    const {
      app: {error, ttlMap, eth},
    } = this;

    if (this.app.config?.traceNotAvailable) {
      return {};
    }

    if (!eth) {
      throw new Errors.RPCError('ETH RPC provider not configured');
    }

    const paramsHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(params))
        .digest('hex');

    return ttlMap.cache(`ConfluxService.getCallTrace(${paramsHash}, ${formatParams})`,
        async () => {
          const len = params?.length || 0;
          if (len < 1) {
            throw new error.ParameterError("Provide the first parameter at least. [callParams, blockNumber?, tracerOptions?].");
          }
          if (len > 3) {
            throw new error.ParameterError("Accepts maximum 3 parameters. [callParams, blockNumber?, tracerOptions?].");
          }

          const [callParams, blockNumber, tracerOptions] = params;
          if (!Object.keys(callParams)?.length) {
            throw new error.ParameterError("The first parameter is an empty object. [callParams, blockNumber?, tracerOptions?].");
          }

          const rpcParams: any[] = [formatParams ? formatCallParams(callParams) : callParams];
          if (blockNumber) {
            rpcParams.push(formatParams ? formatBlockNumber(blockNumber) : blockNumber)
          }
          if (tracerOptions) {
            rpcParams.push(tracerOptions)
          }

          const traceCall = await sendRpc(eth, "debug_traceCall", rpcParams);

          const {addressSet, toAddressSet, methodList} = ConfluxService.extractTraceCall(traceCall);

          const {authMap, methodMap, proxyMap} = await this.getAdditionalInfo(undefined, toAddressSet, methodList);

          const result = {} as any;
          result.traceCall = traceCall;
          result.authMap = authMap;
          result.methodMap = methodMap;
          result.proxyMap = proxyMap;
          Object.values(authMap).forEach((delegatedAddr: string) => addressSet.add(delegatedAddr));
          result.addressArray = [...addressSet];

          return result;
        },
        {ttl: 5},
    );
  }

  static extractTraceCall(traceResponse: any) {
    const addressSet = new Set<string>();
    const toAddressSet = new Set<string>();
    const methodMap = new Map<string, Set<string>>(); // methodId => set(address)

    function traverseCall(call: any): void {
      if (!call) {
        return;
      }

      const {from, to, input} = call;

      if (from) {
        call.from = fmtAddr(from, StatApp.networkId);
        addressSet.add(from);
      }

      if (to) {
        call.to = fmtAddr(to, StatApp.networkId);
        addressSet.add(to);
        toAddressSet.add(to)
      }

      if (input && input.length >= 10 && to) {
        const {method, inputPrecompiled} = ConfluxService.getMethodInfo(input, to);

        let set = methodMap.get(method.method);
        if (!set) {
          set = new Set<string>();
          methodMap.set(method.method, set);
        }
        set.add(to);

        if (inputPrecompiled) {
          call.input = inputPrecompiled;
        }
      }

      if (call.calls && Array.isArray(call.calls)) {
        for (const subCall of call.calls) {
          traverseCall(subCall);
        }
      }
    }

    const topCall = traceResponse?.result ? traceResponse.result : traceResponse;
    const {structLogs, type} = topCall;
    if (structLogs) { // structLogs
      return {addressSet, toAddressSet, methodList: []};
    } else if (type) { // callTracer
      traverseCall(topCall);
    } else { // prestateTracer
      Object.keys(topCall).forEach(address => addressSet.add(address));
    }

    const methodList = _.flatten(
        [...methodMap.keys()].map(
            method => [...methodMap.get(method)].map(
                to => ({method, to})
            )
        )
    );

    if (topCall?.logs?.length) {
      for (const log of topCall.logs) {
        const addr = fmtAddr(log.address, StatApp.networkId);
        log.address = addr;
        addressSet.add(addr);
        toAddressSet.add(addr);
      }
    }

    return {
      addressSet,
      toAddressSet,
      methodList,
    };
  }

  static getMethodInfo(input, to) {
    const precompiled = CONST.PRECOMPILED_ADDR_CONTRACT_MAP[format.hexAddress(to)];
    if (precompiled) {
      return {
        method: {to, method: precompiled.methodId},
        inputPrecompiled: (input.length - 2) % 64 === 0 ? (precompiled.methodId + input.substring(2)) : undefined
      };
    } else {
      return {
        method: {to, method: input.substring(0, 10)}
      };
    }
  }

  private async getAdditionalInfo(
      transactionHash: string,
      toAddressSet: Set<string>,
      methodList: { to: string; method: string; methodId?: string; }[]
  ) {
    const authMap = {};
    if (StatApp.isEVM && methodList?.length) {
      const idToHexMap = await Hex40Map.findAll({
        where: {hex: {[Op.in]: methodList.map(item => format.hexAddress(item.to).slice(2))}},
      }).then(list => Object.fromEntries(list.map(item => [item.id, `0x${item.hex}`.toLowerCase()])));
      const ids = await TraceCreateContract.findAll({
        where: {to: {[Op.in]: Object.keys(idToHexMap)}}
      }).then(list => list.map(item => String(item.to)));
      const hexes = Object.entries(idToHexMap)
          .filter(([key]) => !ids.includes(key))
          .map(([, value]) => value);

      if (hexes?.length) {
        let tasks;
        if (transactionHash) {
          const {epochNumber, index} = await this.getTransactionReceipt(transactionHash).catch(() => undefined) || {};
          if (_.isNil(index)) {
            throw new Errors.RPCError("Failed to get tx index by sdk");
          }
          tasks = hexes.map(hex => AuthAction.sequelize.query(`
              select * from auth_action 
              where author = ? and result = 'success' and (blockNumber < ? or (blockNumber = ? and transactionPosition <= ?))
              order by blockNumber desc, transactionPosition desc
              limit 1
              `, {
            type: QueryTypes.SELECT,
            replacements: [hex, epochNumber, epochNumber, index]
          }).then(items => items?.length ? items[0] : null));
        } else {
          tasks = hexes.map(hex => AuthAction.sequelize.query(`
              select * from auth_action 
              where author = ? and result = 'success'
              order by blockNumber desc, transactionPosition desc
              limit 1
              `, {
            type: QueryTypes.SELECT,
            replacements: [hex]
          }).then(items => items?.length ? items[0] : null));
        }

        const auths = await Promise.all(tasks);
        auths.filter((auth: any) => auth && auth.address !== CONST.ZERO_ADDRESS).forEach((auth: any) =>
            authMap[fmtAddr(auth.author, StatApp.networkId)] = fmtAddr(auth.address, StatApp.networkId)
        )
      }
    }

    const methodMap = {};
    if (methodList?.length) {
      methodList.forEach(item => {
        const delegatedAddr = authMap[fmtAddr(item.to, StatApp.networkId)];
        if (delegatedAddr) {
          item.to = delegatedAddr;
        }
      })
      const ids = await getAddrIdArray(methodList.map(item => item.to));
      await fillMethodInfo(methodList, ids, true, true);
      methodList.forEach(({to, method, methodId}) => {
        methodMap[methodId] ||= {};
        methodMap[methodId][fmtAddr(to, StatApp.networkId)] = method;
      });
    }

    const proxyMap = {};
    Object.values(authMap).forEach((delegatedAddr: string) => toAddressSet.add(delegatedAddr));
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
              proxyMap[fmtAddr(item.hex, StatApp.networkId)] =
                  item.proxyType === CONST.PROXY_PATTERN.PROXY ? "Proxy" : "BeaconProxy"
          );
    }

    return {
      authMap,
      methodMap,
      proxyMap
    };
  }
}

export interface CallParams {
  /**
   * basic params
   */
  from?: string;
  to?: string;
  gas?: bigint | string | number;
  gasPrice?: bigint | string | number;
  nonce?: bigint | string | number;
  value?: bigint | string | number;
  data?: string;
  input?: string; // alias of data field
  chainId?: bigint | string | number;

  /**
   * tx type
   * 0 - Legacy
   * 1 - EIP-2930 (Access List)
   * 2 - EIP-1559 (Dynamic Fee)
   * 3 - EIP-4844 (Blob)
   * 4 - EIP-7702 (Set Code)
   */
  type?: number | string;

  /**
   * EIP-1559 params
   */
  maxPriorityFeePerGas?: bigint | string | number;
  maxFeePerGas?: bigint | string | number;

  /**
   * EIP-2930 params
   */
  accessList?: Array<{
    address: string;
    storageKeys: string[];
  }>;

  /**
   * EIP-7702 params
   */
  authorizationList?: Authorization[];
}

export interface Authorization {
  chainId: bigint | string | number;
  address: string;
  nonce: bigint | string | number;
  yParity: number;
  r: string;
  s: string;
}

export interface TracerOptions {
  tracer?: string; // tracer type: callTracer, prestateTracer, structLogs
  tracerConfig?: Record<string, any>; // tracer config details
}

