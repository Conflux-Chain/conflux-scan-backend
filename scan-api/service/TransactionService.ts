import {ScanApp, ScanCtx} from "./index";
import {StatApp} from "../../stat/StatApp";
import {NoCoreSpace} from "../../stat/config/StatConfig";

const lodash = require('lodash');
const limitMap = require('limit-map');
const {fetchEnsMap} = require("../../stat/service/ens/EnsService");
const {CENSOR_STATUS} = require("../../stat/service/censor/CensorService");
const {hexToUtf8, utf8ToHex} = require("../../stat/service/tool/CensorTool");
const {extractActualGasCost} = require("../../stat/service/common/utils");
const BigFixed = require('bigfixed');

const RECEIPT_FIELDS = [
  'gasCoveredBySponsor',
  'gasFee',
  'gasUsed',
  'stateRoot',
  'storageCollateralized',
  'storageCoveredBySponsor',
  'storageReleased',
  'txExecErrorMsg',
  'burntGasFee',
  'effectiveGasPrice',
];

export class TransactionService {
  app: ScanApp & any;
  constructor(app) {
    this.app = app;
  }

  async query({ hash, fields, aggregate } = {} as any) {
    const {
      app: { CONST, service },
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

    let txInputData = transaction.data;
    const censorResult = await service.censor.getCensorResult(hash);
    if(censorResult && (censorResult.censorStatus === CENSOR_STATUS.REJECT || censorResult.censorStatus === CENSOR_STATUS.SUSPECT)) {
      const {data} = hexToUtf8(transaction.data.substr(2));
      const mosaicData = service.censor.mosaicText(data);
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
    let gasCharged = NoCoreSpace ? Number(receipt?.gasUsed || 0)
        : Math.max(Number(receipt?.gasUsed || 0), (Number(transaction.gas) * 3) / 4)
    let gasFee = StatApp.isEVM ? Number(gasPrice) * gasCharged
        : (receipt?.gasFee || Number(gasPrice) * gasCharged)
    const actualGasCost = extractActualGasCost(receipt?.txExecErrorMsg)
    if(lodash.isNumber(actualGasCost)) {
      gasFee = BigFixed(actualGasCost)
      gasCharged = Number(gasPrice) === 0 ? '0' : BigFixed(actualGasCost).div(BigFixed(gasPrice))
    }

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
        }
    );
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
      app: { service, tool,  },
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
        result.ensInfo = await fetchEnsMap(result.list,'from','to')
        return result;
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

