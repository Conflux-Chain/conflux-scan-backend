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

export class TransactionService {
  app: ScanApp & any;
  constructor(app) {
    this.app = app;
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
      .then(res=>{
        return res ? service.accountQuery.patchAddressInfo([res], '', 'address').then(()=>res) : null;
      }).catch(e=>{
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

    transaction.status = transaction.status ?? receipt?.outcomeStatus
    // XXX: transaction.epochNumber come from `service.conflux.getTransactionByHash`
    const epoch = await service.epoch.query({ epochNumber: transaction.epochNumber }) || {};
    const gasPrice = receipt?.effectiveGasPrice || transaction.gasPrice || BigInt(0);

    // using actualGasCost as gasFee when NotEnoughCash error occurs
    // e.g. "txExecErrorMsg": "NotEnoughCash { required: 10000000000000000000, got: 0, actual_gas_cost: 0, max_storage_limit_cost: 0 }"
    const receiptGasUsed = Number(receipt?.gasUsed || 0);
    let gasCharged = NoCoreSpace ? receiptGasUsed
        : Math.max(receiptGasUsed, Math.ceil((Number(transaction.gas) * 3) / 4))
    let gasFee = receipt?.gasFee || Number(gasPrice) * gasCharged
    const actualGasCost = extractActualGasCost(receipt?.txExecErrorMsg)
    if(lodash.isNumber(actualGasCost)) {
      gasFee = BigFixed(actualGasCost)
      gasCharged = Number(gasPrice) === 0 ? '0' : BigFixed(actualGasCost).div(BigFixed(gasPrice))
    }

    const [cfxTransfers, tokenTransfers] = await Promise.all([
      this.getCfxTransfers(transaction.hash),
      this.getTokenTransfers(transaction.hash),
    ]);
    const addressSet = new Set<string>();
    cfxTransfers.list.forEach(item => {addressSet.add(item.from);addressSet.add(item.to);})
    tokenTransfers.list.forEach(item => {addressSet.add(item.from);addressSet.add(item.to);addressSet.add(item.address);})
    const nameMap = await service.accountQuery.list([...addressSet]);

    // zg rpc do not return contract address on transaction
    const contractCreated = receipt?.contractCreated ?? transaction.contractCreated
    return lodash.defaults({aggregate, data: txInputData, gasPrice, gasFee: gasFee.toString(),
          gasCharged: gasCharged.toString(), contractCreated},
        transaction, receipt, {
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

  private MAX_RECORDS_CFX_TRANSFER = 100;

  async getCfxTransfers(txHash: string) {
    const {
      app: {service},
    } = this as ScanCtx;

    const result = await service.conflux.getTransactionTrace(txHash);

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

    return {total: list.length, list: list.slice(0, this.MAX_RECORDS_CFX_TRANSFER)};
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

  async countAndList({ fields, ...options } = {} as any) {
    const {
      app: { service, tool },
    } = this;

    let result;
    if (options.blockHash !== undefined) {
      tool.checkExist(options, {
        blockHash: true, accountAddress: false, txType: false, status: false,
        minEpochNumber: false, maxEpochNumber: false, minTimestamp: false, maxTimestamp: false,
      });

      result = await this._countAndListByBlockHash(options);
    } else {
        result = await service.fullBlock.listTransaction(options);
        return result;
    }

    result.list = await limitMap(result.list,
      async (object) => {
        const transaction = await this.query({ hash: object.hash, fields });
        return lodash.defaults({}, transaction, object);
      },
      { limit: 100 },
    );

    return result;
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

