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

    const countMap = {}
    const typeMap = {
      cfxTransferCount: CONST.TRANSFER_TYPE.CFX,
      erc20TransferCount: CONST.TRANSFER_TYPE.ERC20,
      erc721TransferCount: CONST.TRANSFER_TYPE.ERC721,
      erc1155TransferCount: CONST.TRANSFER_TYPE.ERC1155,
    }
    await Promise.all(fields.filter(k=>typeMap[k]).map((k)=>{
      return service.transfer.count({ accountAddress: address, transferType: typeMap[k] }).then(res=>{
        countMap[k] = res
      });
    }))

    return lodash.defaults({ address }, account, {
      blockCount,
      transactionCount,
      ...countMap
    });
  }
}

module.exports = AccountService;
