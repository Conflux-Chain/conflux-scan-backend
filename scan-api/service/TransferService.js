const lodash = require('lodash');
const limitMap = require('limit-map');
const {fetchEnsMap} = require("../../stat/dist/service/ens/EnsService");
// const { KV, KEY_TRANSFER_QUERY_RDB_SWITCH } = require('../../stat/dist/model/KV');

const TOKEN_FIELDS = ['name', 'symbol', 'decimals', 'granularity'];

class TransferService {
  constructor(app) {
    this.app = app;
  }

  async _fill(transfer, fields) {
    const {
      app: { service },
    } = this;

    let token = {};
    if (lodash.intersection(fields, TOKEN_FIELDS).length) {
      token = await service.conflux.getToken(transfer.address) || {};
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
/*      const rdbSwitch = await KV.getSwitch(KEY_TRANSFER_QUERY_RDB_SWITCH);
      if (rdbSwitch) {*/
        result = await this._countAndListByRdb(options);
        await fetchEnsMap(result.list,'from','to')
        return result;
      /*  return lodash.defaults({ rdb: rdbSwitch }, result);
      }
      result = await this._countAndListBySync(options);*/
    }
    await fetchEnsMap(result.list,'from','to')
    return result;
  }

  async _countAndListByRdb({ transferType, ...options }) {
    const iterator = this._getTransferService(transferType);
    return iterator.listTransfer(options);
  }

  async _countAndListBySync({ transferType, fields, ...options }) {
    const {
      app: { CONST, error, syncSDK },
    } = this;

    let iterator;
    switch (transferType) {
      case CONST.TRANSFER_TYPE.CFX:
        iterator = (o) => syncSDK.countAndListCFXTransfer(o);
        break;
      case CONST.TRANSFER_TYPE.ERC20:
        iterator = (o) => syncSDK.countAndListERC20Transfer(o);
        break;
      case CONST.TRANSFER_TYPE.ERC721:
        iterator = (o) => syncSDK.countAndListERC721Transfer(o);
        break;
      case CONST.TRANSFER_TYPE.ERC777:
        iterator = (o) => syncSDK.countAndListERC777Transfer(o);
        break;
      case CONST.TRANSFER_TYPE.ERC1155:
        iterator = (o) => syncSDK.countAndListERC1155Transfer(o);
        break;
      default:
        throw new error.ParameterError(`unexpected transferType="${transferType}"`);
    }

    const result = await iterator(options);
    result.list = await limitMap(result.list,
      (object) => this._fill(object, fields),
      { limit: 100 },
    );
    return result;
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
  async listAllAccountAddress({ transferType, address }) {
    const {
      app: { CONST, tool },
    } = this;

/*    const accountAddressArray = [];
    const rdbSwitch = await KV.getSwitch(KEY_TRANSFER_QUERY_RDB_SWITCH);
    if (rdbSwitch) {*/
      const page = this._listAccountAddressByRdb({ transferType, address, limit: CONST.LIST_LIMIT });
      return page?.list;
   /* }

    for (let minAccountAddress = CONST.NULL_ADDRESS; minAccountAddress; minAccountAddress = tool.addHex(minAccountAddress, 1)) {
      const addressArray = await this._listAccountAddress({
        transferType,
        address,
        minAccountAddress,
        limit: CONST.LIST_LIMIT,
      });

      minAccountAddress = lodash.last(addressArray);
      accountAddressArray.push(...addressArray);
    }

    return accountAddressArray;*/
  }

  async _listAccountAddressByRdb({ transferType, ...options }) {
    const iterator = this._getTransferService(transferType);
    return iterator.listAccountAddress(options);
  }

  async _listAccountAddress({ transferType, ...options }) {
    const {
      app: { CONST, syncSDK, error },
    } = this;

    let iterator;
    switch (transferType) {
      case CONST.TRANSFER_TYPE.CFX:
        iterator = (o) => syncSDK.listCFXAccount(o);
        break;
      case CONST.TRANSFER_TYPE.ERC20:
        iterator = (o) => syncSDK.listERC20Account(o);
        break;
      case CONST.TRANSFER_TYPE.ERC721:
        iterator = (o) => syncSDK.listERC721Account(o);
        break;
      case CONST.TRANSFER_TYPE.ERC777:
        iterator = (o) => syncSDK.listERC777Account(o);
        break;
      case CONST.TRANSFER_TYPE.ERC1155:
        iterator = (o) => syncSDK.listERC1155Account(o);
        break;
      default:
        throw new error.ParameterError(`unexpected transferType="${transferType}"`);
    }

    const list = await iterator(options);
    return list.map((each) => each.accountAddress);
  }

  _getTransferService(transferType) {
    const {
      app: { CONST, error, service },
    } = this;

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
/*      case CONST.TRANSFER_TYPE.ERC777:
        iterator = service.crc777Transfer;
        break;*/
      case CONST.TRANSFER_TYPE.ERC1155:
        iterator = service.crc1155Transfer;
        break;
      default:
        throw new error.ParameterError(`unexpected transferType="${transferType}"`);
    }
    return iterator;
  }

  async transferTreeByTransactionHash({ transactionHash }) {
    const {
      app: { service },
    } = this;

    return service.conflux.getTransactionCFXTransferTree(transactionHash);
  }
}

module.exports = TransferService;
