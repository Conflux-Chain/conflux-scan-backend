const lodash = require('lodash');

class AccountService {
  constructor(app) {
    this.app = app;
  }

  async query({ address, fields }) {
    const {
      app: { CONST, service },
    } = this;

    const account = await service.conflux.getAccount(address);
    if (account.codeHash === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470') {
      account.codeHash = ''; // replace code hash of '' to empty.
    }

    let blockCount;
    if (lodash.includes(fields, 'blockCount')) {
      blockCount = await service.block.count({ miner: address });
    }

    let transactionCount;
    if (lodash.includes(fields, 'transactionCount')) {
      transactionCount = await service.transaction.count({ accountAddress: address });
    }

    const tabMap = await service.accountQuery.getBasicInfo(address);

    const collateralForStorageInfo = await service.accountQuery.getCollateralForStorageInfo(address);

    return lodash.defaults({ address }, account, {
      blockCount,
      transactionCount,
      ...tabMap,
      collateralForStorageInfo,
    });
  }
}

module.exports = AccountService;
