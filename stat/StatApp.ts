import {StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Sequelize} from "sequelize";
// import * as pino from 'pino'
import {TxnSync} from "./service/TxnSync";
import {BlockAndMinerSync} from "./service/BlockAndMinerSync";
import {RankService} from "./service/RankService";
import {Conflux} from "js-conflux-sdk";
import {initOss, TokenTool} from "./service/tool/TokenTool";
import {CfxWatcher, Erc20Watcher} from "./service/watcher/BalanceWatcher";
import {BalanceService} from "./service/watcher/BalanceService";
import {ContractService} from "./service/contract/ContractService";
import {ChainWatcher} from "./service/watcher/chain/ChainWatcher";
import {BatchBalanceWatcher} from "./service/watcher/BatchBalanceWatcher";
import {DailyTxnSync, scheduleDailyTokenStat} from "./service/DailyTxnSync";
import {DailyTxnQuery} from "./service/DailyTxnQuery";
import {CfxHolderSync} from "./service/CfxHolderSync";
import {CfxHolderQuery} from "./service/CfxHolderQuery";
import {TokenQuery} from "./service/TokenQuery";
import {BlockTraceCreateSync} from "./service/BlockTraceCreateSync";
import {BlockTraceCreateQuery} from "./service/BlockTraceCreateQuery";
import { Monitor } from "./monitor/Monitor";
import {scheduleDailyActiveAddress} from "./model/StatAddress";
import {EpochSync} from "./service/EpochSync";
import {DailyContractCreateSync} from "./service/DailyContractCreateSync";
import {DailyContractCreateQuery} from "./service/DailyContractCreateQuery";
import {ReportService} from "./service/ReportService";
import {redisWrap, RedisWrap} from "./service/RedisWrap";
import {QuoteSync} from "./service/QuoteSync";
import {HomeDashboardService} from "./service/HomeDashboardService";
import {ContractQuery} from "./service/ContractQuery";
import {DailyContractStatSync} from "./service/DailyContractStatSync";
import {DailyContractStatQuery} from "./service/DailyContractStatQuery";
import {DailyContractRegisterSync} from "./service/DailyContractRegisterSync";
import {DailyContractRegisterQuery} from "./service/DailyContractRegisterQuery";
import {DailyBlockDataStatSync} from "./service/DailyBlockDataStatSync";
import {DailyBlockDataStatQuery} from "./service/DailyBlockDataStatQuery";
import {NFTPreviewService} from "./service/nftchecker/NFTPreviewService";
import {NFTCheckerService} from "./service/nftchecker/NFTCheckerService";
import {TokenSecurityAuditSync} from "./service/TokenSecurityAuditSync";
import {patchFormat, patchHttpProvider} from "./service/common/utils";
import {KV} from "./model/KV";
import {PosQuery} from "./service/pos/PosQuery";
patchFormat();
export class StatApp{
    public config: StatConfig;
    public sequelize: Sequelize;
    public blockAndMinerSync: BlockAndMinerSync;
    public balanceService: BalanceService;
    public rankService: RankService;
    public txnSync: TxnSync;
    public cfx: Conflux;
    public contractService: ContractService;
    public batchBalanceWatcher: BatchBalanceWatcher;
    public cfxWatcher:CfxWatcher;
    public dailyTxnSync: DailyTxnSync;
    public posQuery: PosQuery
    public dailyTxnQuery: DailyTxnQuery;
    public cfxHolderSync: CfxHolderSync;
    public cfxHolderQuery: CfxHolderQuery;
    public tokenQuery: TokenQuery;
    public traceCreateSync: BlockTraceCreateSync
    public traceCreateQuery: BlockTraceCreateQuery;
    public epochSync: EpochSync
    public contractCreateSync: DailyContractCreateSync
    public contractCreateQuery: DailyContractCreateQuery;
    public siteVerify: ReportService;
    public quoteSync: QuoteSync;
    public homeDashboardService: HomeDashboardService;
    public contractQuery: ContractQuery;
    public contractStatSync: DailyContractStatSync;
    public contractStatQuery: DailyContractStatQuery;
    public contractRegisterSync: DailyContractRegisterSync
    public contractRegisterQuery: DailyContractRegisterQuery;
    public blockDataStatSync: DailyBlockDataStatSync;
    public blockDataStatQuery: DailyBlockDataStatQuery;
    public nftPreviewService: NFTPreviewService;
    public nftCheckerService: NFTCheckerService;
    public tokenSecurityAuditSync: TokenSecurityAuditSync;
    public tokenTool: TokenTool;
    public static networkId = 1029
    public static readonly = false
    constructor(config: StatConfig) {
        this.config = config;
    }
    public async initRedis() {
        let redisConf = this.config.redis;
        return RedisWrap.connect(redisConf)
    }
    public async init() {
        this.cfx = new Conflux({...this.config.conflux})
        patchHttpProvider(this.cfx, this.config.conflux, 'StatApp')
        // @ts-ignore
        await this.cfx.updateNetworkId();
        const cfxStatus:any = await this.cfx.getStatus()
        StatApp.networkId = cfxStatus.networkId
        StatApp.readonly = this.config.database.readonly
        console.log(`conflux network id ${StatApp.networkId}, config:`, this.config.conflux)
        this.tokenTool = new TokenTool(this.cfx);
        // const logger = pino()
        this.sequelize = createDB(this.config.databaseRW);
        const {sequelize} = this;
        await Promise.all([
            this.initRedis(),
            initModel(sequelize),
            initOss(this.config.oss)
        ])
        if (this.config.database.syncSchema) {
            console.log(`sync model begin.`)
            await sequelize.sync({});
        } else {
            console.log(`skip sync db schema.`)
        }
        KV.setupSwitch().then()
        this.rankService = new RankService(this)
        this.txnSync = new TxnSync(this);
        this.blockAndMinerSync = new BlockAndMinerSync(sequelize, this.cfx);
        const utilContract = await BatchBalanceWatcher.getUtilContractAddr();
        if (this.config.watchCfxBalance) {
            (this.cfxWatcher = new CfxWatcher('cfx', this.cfx)).schedule(this.config.cfxWatcherDelay).then()
            this.batchBalanceWatcher = new BatchBalanceWatcher(this.cfx, this.config.erc20watchList, this.cfxWatcher, utilContract)
            this.batchBalanceWatcher.schedule().then()
            this.batchBalanceWatcher.listenTransfer().then()
        }
        this.config.erc20watchList.forEach(erc20=>{
            const watcher = new Erc20Watcher(erc20.name, erc20.address, this.cfx, {tokenType: erc20.tokenType})
            watcher.schedule(erc20.watchDelay)
        })
        // @ts-ignore
        this.balanceService = new BalanceService(this, this.config.erc20watchList, StatApp.networkId)
        this.balanceService.schedule(3000)
        new ChainWatcher().watchPivotSwitch({cfxWsUrl: this.config.cfxWsUrl}).then()
        //
        this.contractService = new ContractService(this.config.scanApiUrl, StatApp.networkId)
        this.contractService.schedule()
        //
        this.dailyTxnSync = new DailyTxnSync();
        this.dailyTxnQuery = new DailyTxnQuery();
        this.posQuery = new PosQuery(this.cfx);
        this.cfxHolderSync = new CfxHolderSync(this.sequelize);
        this.cfxHolderQuery = new CfxHolderQuery();
        this.tokenQuery = new TokenQuery(this);
        this.traceCreateSync = new BlockTraceCreateSync(this.cfx)
        this.traceCreateQuery = new BlockTraceCreateQuery(this);
        this.epochSync = new EpochSync(this);
        this.contractCreateSync = new DailyContractCreateSync(this.sequelize);
        this.contractCreateQuery = new DailyContractCreateQuery();
        this.siteVerify = new ReportService(this);
        this.quoteSync = new QuoteSync(this);
        this.homeDashboardService = new HomeDashboardService(this);
        this.contractQuery = new ContractQuery(this);
        this.contractStatSync = new DailyContractStatSync(this.sequelize);
        this.contractStatQuery = new DailyContractStatQuery();
        this.contractRegisterSync = new DailyContractRegisterSync(this.sequelize);
        this.contractRegisterQuery = new DailyContractRegisterQuery();
        this.blockDataStatSync = new DailyBlockDataStatSync(this.sequelize);
        this.blockDataStatQuery = new DailyBlockDataStatQuery(null);
        this.nftPreviewService = new NFTPreviewService(this);
        this.nftCheckerService = new NFTCheckerService(this, utilContract);
        this.tokenSecurityAuditSync = new TokenSecurityAuditSync(this);
        //
        if (this.config.syncBlock) {
            await this.blockAndMinerSync.checkPosition(); // miner block
            await this.blockAndMinerSync.schedule(this.config.syncBlockDelay)
        }
        this.txnSync.scheduleCache()
        if (this.config.syncTxnCountDaily) {
            await this.dailyTxnSync.schedule(); // dailyTxn
            scheduleDailyActiveAddress()
                .then(()=>{scheduleDailyTokenStat()})
        }
        if (this.config.syncCfxHolderCountDaily) {
            await this.cfxHolderSync.schedule(); // dailyCfxHolder
        }
        if (this.config.syncTraceCreateContract) {
            await this.traceCreateSync.schedule(this.config.syncTraceCreateContractDelay); // trace create
        }
        if (this.config.checkRankDelay) {
            let monitor = new Monitor(this.config.dingTalkToken, this.config.serverTag);
            monitor.checkFullBlockSyncRunning().then()
        }
        if (this.config.syncContractCreateCountDaily) {
            await this.contractCreateSync.schedule(); // dailyContractCreate
        }
        if (this.config.syncQuote) {
            await this.quoteSync.schedule(this.config.syncQuoteDelay); // token quote
        }
        if (this.config.syncHomeDashboardData) {
            await this.homeDashboardService.schedule(this.config.syncHomeDashboardDataDelay); // home dash board
        }
        if (this.config.syncContractStatInfoDaily) {
            await this.contractStatSync.schedule();
        }
        if (this.config.syncEpoch) {
            await this.epochSync.run(this.config.syncEpochNumber);
        }
        if (this.config.syncContractRegisterCountDaily) {
            await this.contractRegisterSync.schedule(); // dailyContractRegister
        }
        if (this.config.syncBlockDataStatDaily) {
            await this.blockDataStatSync.schedule(); // daily block data stat
        }
        if (this.config.syncTokenSecurityAudit) {
            await this.tokenSecurityAuditSync.schedule();
        }
        // Register global process events and graceful shutdown
        // registerProcessEvents(logger, this.sequelize)
    }

}

