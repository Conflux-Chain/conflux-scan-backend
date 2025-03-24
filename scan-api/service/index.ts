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

export interface ScanCtx {
  app: ScanApp
}
export interface ScanApp {
  service: ScanServices;
  CONST: any;
  cfx: Conflux;
  ttlMap: any;
  config: any;
  error: any;
  tool: any;
  logger: any;
  syncSDK: any;
  tokenTool: TokenTool;
  dingTalk: any;
  type: any;
}

export class ScanServices {
  public a: number;
  public conflux: ConfluxService;
  public statistic: StatisticService;
  public epoch: EpochService;
  public block: BlockService;
  public transaction: TransactionService;
  public account: AccountService;
  public contract: ContractService;
  public token: TokenService;
  public eventLog: EventLogService;
  public announce: AnnounceService;
  public transfer: TransferService;
  public recaptcha: RecaptchaService;
  public desensitizer: Desensitizer;
  public homeDashboard: HomeDashboardService;
  public blockData: DailyBlockDataStatQuery;
  public epochRdb: EpochQuery;
  public fullBlock: FullBlockQuery;
  public cfxTransfer: CfxTransferQuery;
  public crc20Transfer: Crc20TransferQuery;
  public crc721Transfer: Crc721TransferQuery;
  public crc3525Transfer: Crc3525TransferQuery;
  /*   public  crc777Transfer: Crc777TransferQuery;*/
  public crc1155Transfer: Crc1155TransferQuery;
  public traceCreate: BlockTraceCreateQuery;
  public contractRdb: ContractQuery;
  public tokenRdb: TokenQuery;
  public ensCheckerQuery: ENSCheckerQuery;
  public accountQuery: AccountQuery;
  public censor: CensorService;
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
/*    crc777Transfer: new Crc777TransferQuery(app),*/
    crc1155Transfer: new Crc1155TransferQuery(app),
    traceCreate: new BlockTraceCreateQuery(app),
    contractRdb: new ContractQuery(app),
    tokenRdb: new TokenQuery(app),
    ensCheckerQuery: new ENSCheckerQuery(app),
    accountQuery: new AccountQuery(app),
    censor: new CensorService(app),
  } as ScanServices;
}
