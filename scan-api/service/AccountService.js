const lodash = require('lodash');

class AccountService {
  constructor(app) {
    this.app = app;
  }

  async query({ address, fields }) {
    const {
      app: { CONST, service },
    } = this;

    // codeHash is here.
    const account = await service.conflux.getAccount(address);
    if (account.codeHash === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470') {
      account.codeHash = ''; // replace code hash of '' to empty.
    }
    // console.log('account is ', account);

    let blockCount;
    if (lodash.includes(fields, 'blockCount')) {
      blockCount = await service.block.count({ miner: address });
    }

    let transactionCount;
    if (lodash.includes(fields, 'transactionCount')) {
      transactionCount = await service.transaction.count({ accountAddress: address });
    }

    let cfxTransferCount;
    if (lodash.includes(fields, 'cfxTransferCount')) {
      cfxTransferCount = await service.transfer.count({ accountAddress: address, transferType: CONST.TRANSFER_TYPE.CFX });
    }

    let erc20TransferCount;
    if (lodash.includes(fields, 'erc20TransferCount')) {
      erc20TransferCount = await service.transfer.count({ accountAddress: address, transferType: CONST.TRANSFER_TYPE.ERC20 });
    }

    let erc777TransferCount;
    if (lodash.includes(fields, 'erc777TransferCount')) {
      erc777TransferCount = await service.transfer.count({ accountAddress: address, transferType: CONST.TRANSFER_TYPE.ERC777 });
    }

    let erc721TransferCount;
    if (lodash.includes(fields, 'erc721TransferCount')) {
      erc721TransferCount = await service.transfer.count({ accountAddress: address, transferType: CONST.TRANSFER_TYPE.ERC721 });
    }

    let erc1155TransferCount;
    if (lodash.includes(fields, 'erc1155TransferCount')) {
      erc1155TransferCount = await service.transfer.count({ accountAddress: address, transferType: CONST.TRANSFER_TYPE.ERC1155 });
      // logger.info({ src: 'test-erc1155count', accountAddress: address, erc1155TransferCount });
    }

    return lodash.defaults({ address }, account, {
      blockCount,
      transactionCount,
      cfxTransferCount,
      erc20TransferCount,
      erc777TransferCount,
      erc721TransferCount,
      erc1155TransferCount,
    });
  }
}

module.exports = AccountService;
