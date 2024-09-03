import {ScanApp, ScanCtx} from "./index";

const lodash = require('lodash');
const limitMap = require('limit-map');
const {fetchEnsMap} = require("../../stat/service/ens/EnsService");

const TOKEN_FIELDS = ['name', 'symbol', 'decimals', 'granularity'];

export class TransferService {
  app: ScanApp & any;
  constructor(app) {
    this.app = app;
  }

  async _fill(transfer, fields) {
    const {
      app: { service, tokenTool },
    } = this;

    let token = {};
    if (lodash.intersection(fields, TOKEN_FIELDS).length) {
      token = await tokenTool.getToken(transfer.address) || {};
      token = lodash.pick(token, TOKEN_FIELDS);
    }

    const epoch = await service.epoch.query({ epochNumber: transfer.epochNumber }) || {};
    return lodash.defaults({}, transfer, token, {
      timestamp: epoch.timestamp,
      syncTimestamp: epoch.timestamp,
    });
  }

  // --------------------------------------------------------------------------
  async count(options = {}) {
    const {
      app: { ttlMap },
    } = this;

    const { total } = await ttlMap.cache(`TransferService.count(${JSON.stringify(options)})`,
      () => this.countAndList({ ...options, limit: 0 }),
      { ttl: 60 * 1000 },
    );
    return total;
  }

  async countAndList(options) {
    let result;

    if (options.transactionHash !== undefined) {
      result = await this._countAndListByTransactionHash(options);
    } else {
        result = await this._countAndListByRdb(options);
        await fetchEnsMap(result.list,'from','to')
        return result;
    }
    await fetchEnsMap(result.list,'from','to')
    return result;
  }

  async _countAndListByRdb({ transferType, ...options }) {
    const iterator = this._getTransferService(transferType);
    return iterator.listTransfer(options);
  }

  async _countAndListByTransactionHash({
    transferType,
    transactionHash,
    tokenArray,
    accountAddress,
    address,
    from,
    to,
    tokenId,
    minTimestamp,
    maxTimestamp,
    minEpochNumber,
    maxEpochNumber,
    skip = 0,
    limit = Infinity,
    reverse = false,
    fields,
    zeroValue = false,
    txType,
  }) {
    const {
      app: { CONST, type, service },
    } = this;

    let iterator;
    switch (transferType) {
      case CONST.TRANSFER_TYPE.CFX:
        iterator = (o, zeroValueSwitch) => service.conflux.getTransactionCFXTransferArray(o, zeroValueSwitch);
        break;
      case CONST.TRANSFER_TYPE.ERC20:
        iterator = (o) => service.conflux.getTransactionERC20TransferArray(o);
        break;
      case CONST.TRANSFER_TYPE.ERC721:
        iterator = (o) => service.conflux.getTransactionERC721TransferArray(o);
        break;
      case CONST.TRANSFER_TYPE.ERC777:
        iterator = (o) => service.conflux.getTransactionERC777TransferArray(o);
        break;
      case CONST.TRANSFER_TYPE.ERC1155:
        iterator = (o) => service.conflux.getTransactionERC1155TransferArray(o);
        break;
      default:
        iterator = (o) => service.conflux.getTransactionERCXXXTransferArray(o);
    }

    let list = await iterator(transactionHash, zeroValue);
    list = await limitMap(list,
      (object) => this._fill(object, fields),
      { limit: 100 },
    );

    if (accountAddress !== undefined) {
      list = list.filter((transfer) => [transfer.operator, transfer.from, transfer.to]
        .filter(Boolean)
        .map(type.address)
        .includes(accountAddress),
      );

      const base32 = type.checksumAddress(accountAddress);
      if (txType === CONST.TX_TYPE.IN) {
        list = list.filter((transfer) => transfer.to === base32 || transfer.to === accountAddress);
      }
      if (txType === CONST.TX_TYPE.OUT) {
        list = list.filter((transfer) => transfer.from === base32 || transfer.from === accountAddress);
      }
    }
    if (address !== undefined) {
      list = list.filter((transfer) => type.address(transfer.address) === address);
    }
    if (from !== undefined && to === undefined) {
      list = list.filter((transfer) => type.address(transfer.from) === from);
    }
    if (to !== undefined && from === undefined) {
      list = list.filter((transfer) => type.address(transfer.to) === to);
    }
    if (from !== undefined && to !== undefined) {
      list = list.filter((transfer) => type.address(transfer.from) === from || type.address(transfer.to) === to);
    }
    if (tokenArray !== undefined) {
      const addressSet = new Set(tokenArray);
      list = list.filter((transfer) => addressSet.has(type.address(transfer.address)));
    }
    if (tokenId !== undefined) {
      list = list.filter((transfer) => transfer.tokenId === tokenId);
    }

    if (minTimestamp !== undefined) {
      list = list.filter((transfer) => transfer.timestamp >= minTimestamp);
    }
    if (maxTimestamp !== undefined) {
      list = list.filter((transfer) => transfer.timestamp <= maxTimestamp);
    }
    if (minEpochNumber !== undefined) {
      list = list.filter((transfer) => transfer.epochNumber >= minEpochNumber);
    }
    if (maxEpochNumber !== undefined) {
      list = list.filter((transfer) => transfer.epochNumber <= maxEpochNumber);
    }

    list = reverse ? [...list].reverse() : list;
    return {
      total: list.length,
      list: list.slice(skip, skip + limit),
    };
  }

  // --------------------------------------------------------------------------
  _getTransferService(transferType) {
    const {
      app: { CONST, error, service },
    } = this as ScanCtx;

    let iterator;
    switch (transferType) {
      case CONST.TRANSFER_TYPE.CFX:
        iterator = service.cfxTransfer;
        break;
      case CONST.TRANSFER_TYPE.ERC20:
        iterator = service.crc20Transfer;
        break;
      case CONST.TRANSFER_TYPE.ERC721:
        iterator = service.crc721Transfer;
        break;
      case CONST.TRANSFER_TYPE.ERC1155:
        iterator = service.crc1155Transfer;
        break;
      case CONST.TRANSFER_TYPE.ERC3525:
        iterator = service.crc3525Transfer;
        break;
      default:
        throw new error.ParameterError(`unexpected transferType="${transferType}"`);
    }
    return iterator;
  }
}

