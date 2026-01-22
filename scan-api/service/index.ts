import {ConfluxService} from './ConfluxService';
import {StatisticService} from "./StatisticService";
import {EpochService} from "./EpochService";
import {BlockService} from "./BlockService";
import {TransactionService} from "./TransactionService";
import {AccountService} from "./AccountService";
import {Conflux} from "js-conflux-sdk";
import {ContractService} from "./ContractService";
import {TokenService} from "./TokenService";
import {EventLogService} from "./EventLogService";
import {TransferService} from "./TransferService";
import {FullBlockQuery} from "../../stat/service/FullBlockQuery";
import {CfxTransferQuery} from "../../stat/service/CfxTransferQuery";
import {Crc20TransferQuery} from "../../stat/service/Crc20TransferQuery";
import {Crc721TransferQuery} from "../../stat/service/Crc721TransferQuery";
import {Crc3525TransferQuery} from "../../stat/service/Crc3525TransferQuery";
import {Crc1155TransferQuery} from "../../stat/service/Crc1155TransferQuery";
import {ContractTraceCreateQuery} from "../../stat/service/ContractTraceCreateQuery";
import {ContractQuery} from "../../stat/service/ContractQuery";
import {TokenQuery} from "../../stat/service/TokenQuery";
import {ENSCheckerQuery} from "../../stat/service/ens/ENSCheckerQuery";
import {AccountQuery} from "../../stat/service/AccountQuery";
import {TokenTool} from "../../stat/service/tool/TokenTool";
import {StatConfig} from "../../stat/config/StatConfig";
import {StatsQuery} from "../../stat/service/StatsQuery";

export interface ScanCtx {
  app: ScanApp
}
export interface ScanApp {
  service?: ScanServices;
  cfx?: Conflux;
  ttlMap?: any;
  config?: StatConfig;
  error?: any;
  tool?: any;
  logger?: any;
  tokenTool?: TokenTool;
  dingTalk?: any;
  type?: any;
  tokenQuery?: TokenQuery;
  contractQuery?: ContractQuery;
}

export interface ScanServices {
  a: number;
  conflux: ConfluxService;
  statistic: StatisticService;
  epoch: EpochService;
  block: BlockService;
  transaction: TransactionService;
  account: AccountService;
  contract: ContractService;
  token: TokenService;
  eventLog: EventLogService;
  transfer: TransferService;
  statsQuery: StatsQuery,
  fullBlock: FullBlockQuery;
  cfxTransfer: CfxTransferQuery;
  crc20Transfer: Crc20TransferQuery;
  crc721Transfer: Crc721TransferQuery;
  crc3525Transfer: Crc3525TransferQuery;
  crc1155Transfer: Crc1155TransferQuery;
  traceCreate: ContractTraceCreateQuery;
  contractQuery: ContractQuery;
  tokenQuery: TokenQuery;
  tokenTool?: TokenTool;
  ensCheckerQuery: ENSCheckerQuery;
  accountQuery: AccountQuery;
}

export function serviceLoader(app) {
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
    transfer: new TransferService(app),
    statsQuery: new StatsQuery(app),
    fullBlock: new FullBlockQuery(app),
    cfxTransfer: new CfxTransferQuery(app),
    crc20Transfer: new Crc20TransferQuery(app),
    crc721Transfer: new Crc721TransferQuery(app),
    crc3525Transfer: new Crc3525TransferQuery(app),
    crc1155Transfer: new Crc1155TransferQuery(app),
    traceCreate: new ContractTraceCreateQuery({cfx: app.cfx}),
    contractQuery: new ContractQuery({cfx: app.cfx, config: app.config.verification}),
    tokenQuery: new TokenQuery(app),
    ensCheckerQuery: new ENSCheckerQuery(app.cfx),
    accountQuery: new AccountQuery(app),
  } as ScanServices;
}
