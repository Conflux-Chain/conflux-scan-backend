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
import {AnnounceService} from "./AnnounceService";
import {TransferService} from "./TransferService";
import {RecaptchaService} from "./RecaptchaService";
import {Desensitizer} from "../../stat/service/Desensitizer";
import {HomeDashboardService} from "../../stat/service/HomeDashboardService";
import {DailyBlockDataStatQuery} from "../../stat/service/DailyBlockDataStatQuery";
import {EpochQuery} from "../../stat/service/EpochQuery";
import {FullBlockQuery} from "../../stat/service/FullBlockQuery";
import {CfxTransferQuery} from "../../stat/service/CfxTransferQuery";
import {Crc20TransferQuery} from "../../stat/service/Crc20TransferQuery";
import {Crc721TransferQuery} from "../../stat/service/Crc721TransferQuery";
import {Crc3525TransferQuery} from "../../stat/service/Crc3525TransferQuery";
import {Crc1155TransferQuery} from "../../stat/service/Crc1155TransferQuery";
import {BlockTraceCreateQuery} from "../../stat/service/BlockTraceCreateQuery";
import {ContractQuery} from "../../stat/service/ContractQuery";
import {TokenQuery} from "../../stat/service/TokenQuery";
import {ENSCheckerQuery} from "../../stat/service/ens/ENSCheckerQuery";
import {AccountQuery} from "../../stat/service/AccountQuery";
import {CensorService} from "../../stat/service/censor/CensorService";
import {TokenTool} from "../../stat/service/tool/TokenTool";
import {StatConfig} from "../../stat/config/StatConfig";
import {JsonRPCSDK} from "../../common/JsonRPCSDK";

export interface ScanCtx {
  app: ScanApp
}
export interface ScanApp {
  service?: ScanServices;
  CONST?: any;
  cfx?: Conflux;
  ttlMap?: any;
  config?: StatConfig;
  error?: any;
  tool?: any;
  logger?: any;
  syncSDK?: any;
  tokenTool?: TokenTool;
  dingTalk?: any;
  type?: any;
  tokenQuery?: TokenQuery;
  jsonRpc?: JsonRPCSDK & any;
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
  announce: AnnounceService;
  transfer: TransferService;
  recaptcha: RecaptchaService;
  desensitizer: Desensitizer;
  homeDashboard: HomeDashboardService;
  blockData: DailyBlockDataStatQuery;
  epochRdb: EpochQuery;
  fullBlock: FullBlockQuery;
  cfxTransfer: CfxTransferQuery;
  crc20Transfer: Crc20TransferQuery;
  crc721Transfer: Crc721TransferQuery;
  crc3525Transfer: Crc3525TransferQuery;
  crc1155Transfer: Crc1155TransferQuery;
  traceCreate: BlockTraceCreateQuery;
  contractQuery: ContractQuery;
  tokenRdb: TokenQuery;
  tokenQuery: TokenQuery;
  tokenTool?: TokenTool;
  ensCheckerQuery: ENSCheckerQuery;
  accountQuery: AccountQuery;
  censor: CensorService;
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
    crc1155Transfer: new Crc1155TransferQuery(app),
    traceCreate: new BlockTraceCreateQuery(app),
    contractQuery: new ContractQuery(app),
    tokenRdb: new TokenQuery(app),
    ensCheckerQuery: new ENSCheckerQuery(app),
    accountQuery: new AccountQuery(app),
    censor: new CensorService(app),
  } as ScanServices;
}
