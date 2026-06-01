import {ScanApp, ScanCtx} from "./index";
import {fmtAddr, StatApp} from "../../stat/StatApp";
import {NoCoreSpace} from "../../stat/config/StatConfig";
import {getDelegatedAddrAtTx} from "../../stat/model/EIP7702model";
import {format} from "js-conflux-sdk";
import {CONST} from "../../stat/service/common/constant";
import {CensorService} from "../../stat/service/censor/CensorService";
import {patchPocketAddress} from "../../stat/model/HexMap";
import {getCfxTransfer} from "../../stat/CfxTransferSync";

const lodash = require('lodash');
const limitMap = require('limit-map');
const {CENSOR_STATUS} = require("../../stat/service/censor/CensorService");
const {hexToUtf8, utf8ToHex} = require("../../stat/service/tool/CensorTool");
const {extractActualGasCost} = require("../../stat/service/common/utils");
const BigFixed = require('bigfixed');

let _instance: TransactionService | undefined;

export function getTransactionService(): TransactionService | undefined {
  return _instance;
}

export class TransactionService {
  app: ScanApp & any;
  constructor(app) {
    this.app = app;
    _instance = this;
  }

  async query({ hash, fields, aggregate } = {} as any) {
    const {
      app: { service },
    } = this as ScanCtx;

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

    let receipt = await service.conflux.getTransactionReceipt(hash).catch(() => undefined) || {};
    if (StatApp.isEVM && receipt.epochNumber && transaction.to) {
      const toHex = format.hexAddress(transaction.to)
      transaction['effectiveAuth'] = await getDelegatedAddrAtTx(toHex, receipt.epochNumber, hash)
      .catch(e=>{
        transaction['effectiveAuthError'] = e;
        return null;
      });
    }

    let txInputData = transaction.data;
    const censorResult = await CensorService.getCensorResult(hash);
    if(censorResult && (censorResult.censorStatus === CENSOR_STATUS.REJECT || censorResult.censorStatus === CENSOR_STATUS.SUSPECT)) {
      const {data} = hexToUtf8(transaction.data.substr(2));
      const mosaicData = CensorService.mosaicText(data);
      txInputData = `0x${utf8ToHex(mosaicData).data}`;
    }

    let baseFeePerGas
    if(transaction?.blockHash) {
      const block = await service.conflux.getBlockByEpochNumber(transaction.epochNumber, false)
      baseFeePerGas = block?.baseFeePerGas
    }

    let typeDesc = CONST.TX_EIP_TYPE[transaction.type]
    !StatApp.isEVM && (typeDesc = typeDesc?.replace('EIP', 'CIP'))

    const epoch = await service.epoch.query({ epochNumber: transaction.epochNumber }) || {};

    const receiptBasic = await this.getRcptBasic(transaction, receipt);

    const [cfxTransfers, tokenTransfers] = await Promise.all([
      this.getCfxTransfers(transaction.hash),
      this.getTokenTransfers(transaction.hash),
    ]);

    const addresses = new Set<string>([
      transaction.from,
      transaction.to,
      transaction.contractCreated,
      transaction.effectiveAuth?.author,
      transaction.effectiveAuth?.address,
      ...cfxTransfers.list.flatMap(item => [item.from, item.to]),
      ...tokenTransfers.list.flatMap(item => [item.from, item.to, item.address]),
    ].filter(Boolean));
    const nameMap = await service.accountQuery.list([...addresses]);

    return lodash.defaults({aggregate, data: txInputData}, receiptBasic, transaction, receipt,
        {
          risk,
          typeDesc,
          baseFeePerGas,
          timestamp: epoch.timestamp,
          syncTimestamp: epoch.timestamp,
          eventLogCount: receipt?.logs?.length,
          cfxTransfers,
          tokenTransfers,
          nameMap,
        }
    );
  }

  private static MAX_RECORDS_CFX_TRANSFER = 100;

  async getCfxTransfers(txHash: string) {
    const {
      app: {service},
    } = this as ScanCtx;

    const result = await service.conflux.getTransactionTrace(txHash);
    return TransactionService.buildCfxTransfersFromTraceObj(result);
  }

  static buildCfxTransfersFromTraceObj(result) {
    const traces = result.traceArray;
    if (!traces) {
      return {total: 0, list: []};
    }

    const list = [];
    for (let traceIdx = 0; traceIdx < traces.length; traceIdx++) {
      const trace = traces[traceIdx];
      let {action: {from, to, fromPocket, toPocket}, valid} = trace;
      if (!valid) {
        continue;
      }

      trace.from = patchPocketAddress(fromPocket, from);
      trace.to = patchPocketAddress(toPocket, to);

      const ts: any = getCfxTransfer(trace);
      if (!ts) {
        continue
      }

      list.push({
        from: ts.from,
        to: ts.to,
        value: ts.value,
        type: ts.type,
        transactionTraceIndex: traceIdx,
      });
    }

    return {total: list.length, list: list.slice(0, TransactionService.MAX_RECORDS_CFX_TRANSFER)};
  }

  private MAX_RECORDS_TOKEN_TRANSFER = 100;

  async getTokenTransfers(txHash: string) {
    const {
      app: {service},
    } = this as ScanCtx;

    const tokenTransfers = await service.conflux.getTransactionTokenTransferArray(txHash);
    const list = tokenTransfers.map((item: any) => {
      delete item.epochNumber;
      delete item.transactionHash;
      delete item.data;
      delete item.topics;
      delete item.blockHash;
      delete item.logIndex;
      delete item.space;
      delete item.transactionIndex;
      item.from = fmtAddr(item.from, StatApp.networkId);
      item.to = fmtAddr(item.to, StatApp.networkId);
      item.address = fmtAddr(item.address, StatApp.networkId);
      return item;
    });

    return {total: list.length, list: list.slice(0, this.MAX_RECORDS_TOKEN_TRANSFER)};
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

  async countAndList(options = {} as any) {
    const {
      app: { service, tool },
    } = this;

    if (options.blockHash === undefined) {
      return service.fullBlock.listTransaction(options);
    }

    tool.checkExist(options, {
      blockHash: true, accountAddress: false, txType: false, status: false,
      minEpochNumber: false, maxEpochNumber: false, minTimestamp: false, maxTimestamp: false,
    });

    const result = await this._countAndListByBlockHash(options);

    if (result?.list?.length) {
      const epoch = await service.epoch.query({epochNumber: result.list[0].epochNumber}) || {};
      result.list = await limitMap(result.list,
          async (tx) => {
            tx.timestamp = epoch.timestamp;
            tx.syncTimestamp = epoch.timestamp;
            tx.from = fmtAddr(tx.from, StatApp.networkId);
            tx.to = fmtAddr(tx.to, StatApp.networkId);
            const rcpt = await this.getRcptBasic(tx);
            return lodash.pick(lodash.defaults({}, rcpt, tx), [
              "epochNumber", "blockPosition", "transactionIndex", "hash",
              "from", "to", "nonce", "method", "gasFee", "gasPrice",
              "value", "contractCreated", "status", "txExecErrorMsg", "syncTimestamp", "timestamp"
            ]);
          },
          { limit: 100 },
      );
    }

    return result;
  }

  async getRcptBasic(tx, receipt?) {
    const {
      app: {service},
    } = this as ScanCtx;

    const {hash, status: txStatus, gasPrice: txGasPrice, gas: txGas, contractCreated: txContractCreated} = tx;

    if (!receipt) {
      receipt = await service.conflux.getTransactionReceipt(hash).catch(() => undefined) || {};
    }

    const status = txStatus ?? receipt?.outcomeStatus;
    const txExecErrorMsg = receipt?.txExecErrorMsg;

    const gasPrice = receipt?.effectiveGasPrice || txGasPrice || BigInt(0);

    const receiptGasUsed = Number(receipt?.gasUsed || 0);
    let gasCharged = NoCoreSpace ? receiptGasUsed : Math.max(receiptGasUsed, Math.ceil((Number(txGas) * 3) / 4));
    let gasFee = receipt?.gasFee || Number(gasPrice) * gasCharged;
    // using actualGasCost as gasFee when NotEnoughCash error occurs
    // e.g. "txExecErrorMsg": "NotEnoughCash { required: 10000000000000000000, got: 0, actual_gas_cost: 0, max_storage_limit_cost: 0 }"
    const actualGasCost = extractActualGasCost(txExecErrorMsg);
    if (lodash.isNumber(actualGasCost)) {
      gasFee = BigFixed(actualGasCost);
      gasCharged = Number(gasPrice) === 0 ? '0' : BigFixed(actualGasCost).div(BigFixed(gasPrice));
    }

    // zg rpc do not return contract address on transaction
    const contractCreated = fmtAddr(receipt?.contractCreated ?? txContractCreated, StatApp.networkId);

    return {
      status,
      txExecErrorMsg,
      gasPrice,
      gasFee: gasFee.toString(),
      gasCharged: gasCharged.toString(),
      contractCreated,
    };
  }

  async _countAndListByBlockHash({
    blockHash,
    skip = 0,
    limit = Infinity,
    reverse = false,
  } = {} as any) {
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

