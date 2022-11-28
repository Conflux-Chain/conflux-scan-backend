const ConfluxService = require('./ConfluxService');
const StatisticService = require('./StatisticService');
const EpochService = require('./EpochService');
const BlockService = require('./BlockService');
const TransactionService = require('./TransactionService');
const AccountService = require('./AccountService');
const ContractService = require('./ContractService');
const TokenService = require('./TokenService');
const EventLogService = require('./EventLogService');
const AnnounceService = require('./AnnounceService');
const TransferService = require('./TransferService');
const RecaptchaService = require('./RecaptchaService');
const { Desensitizer } = require('../../stat/dist/service/Desensitizer');
const { HomeDashboardService } = require('../../stat/dist/service/HomeDashboardService');
const { DailyBlockDataStatQuery } = require('../../stat/dist/service/DailyBlockDataStatQuery');
const { EpochQuery } = require('../../stat/dist/service/EpochQuery');
const { FullBlockQuery } = require('../../stat/dist/service/FullBlockQuery');
const { CfxTransferQuery } = require('../../stat/dist/service/CfxTransferQuery');
const { Crc20TransferQuery } = require('../../stat/dist/service/Crc20TransferQuery');
const { Crc721TransferQuery } = require('../../stat/dist/service/Crc721TransferQuery');
const { Crc3525TransferQuery } = require('../../stat/dist/service/Crc3525TransferQuery');
/*const { Crc777TransferQuery } = require('../../stat/dist/service/Crc777TransferQuery');*/
const { Crc1155TransferQuery } = require('../../stat/dist/service/Crc1155TransferQuery');
const { BlockTraceCreateQuery } = require('../../stat/dist/service/BlockTraceCreateQuery');
const { ContractQuery } = require('../../stat/dist/service/ContractQuery');
const { TokenQuery } = require('../../stat/dist/service/TokenQuery');
const {ENSCheckerQuery} = require("../../stat/dist/service/ens/ENSCheckerQuery");
const {AccountQuery} = require("../../stat/dist/service/AccountQuery");

function serviceLoader(app) {
  return {
    conflux: new ConfluxService(app),
    statistic: new StatisticService(app),
    epoch: new EpochService(app),
    block: new BlockService(app),
    transaction: new TransactionService(app),
    account: new AccountService(app),
    contract: new ContractService(app),
    token: new TokenService(app),
    eventLog: new EventLogService(app),
    announce: new AnnounceService(app),
    transfer: new TransferService(app),
    recaptcha: new RecaptchaService(app),
    desensitizer: new Desensitizer(app),
    homeDashboard: new HomeDashboardService(app),
    blockData: new DailyBlockDataStatQuery(app),
    epochRdb: new EpochQuery(app),
    fullBlock: new FullBlockQuery(app),
    cfxTransfer: new CfxTransferQuery(app),
    crc20Transfer: new Crc20TransferQuery(app),
    crc721Transfer: new Crc721TransferQuery(app),
    crc3525Transfer: new Crc3525TransferQuery(app),
/*    crc777Transfer: new Crc777TransferQuery(app),*/
    crc1155Transfer: new Crc1155TransferQuery(app),
    traceCreate: new BlockTraceCreateQuery(app),
    contractRdb: new ContractQuery(app),
    tokenRdb: new TokenQuery(app),
    ensCheckerQuery: new ENSCheckerQuery(app),
    accountQuery: new AccountQuery(app),
  };
}

module.exports = serviceLoader;
