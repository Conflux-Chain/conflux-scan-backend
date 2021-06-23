import {StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Sequelize} from "sequelize";
// import * as pino from 'pino'
import {TxnSync} from "./service/TxnSync";
import {BlockAndMinerSync} from "./service/BlockAndMinerSync";
import {RankService} from "./service/RankService";
import {Conflux} from "js-conflux-sdk";
import {TokenTool} from "./service/tool/TokenTool";
import {CfxWatcher, Erc20Watcher} from "./service/watcher/BalanceWatcher";
import {BlockTraceSync} from "./service/BlockTraceSync";
import {BalanceService} from "./service/watcher/BalanceService";
import {ContractService} from "./service/contract/ContractService";
import {ChainWatcher} from "./service/watcher/chain/ChainWatcher";
import {BatchBalanceWatcher} from "./service/watcher/BatchBalanceWatcher";
import {DailyTxnSync, scheduleDailyTokenStat} from "./service/DailyTxnSync";
import {DailyTxnQuery} from "./service/DailyTxnQuery";
import {CfxHolderSync} from "./service/CfxHolderSync";
import {CfxHolderQuery} from "./service/CfxHolderQuery";
import {TokenSync} from "./service/TokenSync";
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
import {ContractStat} from "./service/ContractStat";
import {DailyContractRegisterSync} from "./service/DailyContractRegisterSync";
import {DailyContractRegisterQuery} from "./service/DailyContractRegisterQuery";

export class StatApp{
    public config: StatConfig;
    public sequelize: Sequelize;
    public blockAndMinerSync: BlockAndMinerSync;
    public balanceService: BalanceService;
    public rankService: RankService;
    public txnSync: TxnSync;
    public traceSync: BlockTraceSync
    public cfx: Conflux;
    public contractService: ContractService;
    public batchBalanceWatcher: BatchBalanceWatcher;
    public cfxWatcher:CfxWatcher;
    public dailyTxnSync: DailyTxnSync;
    public dailyTxnQuery: DailyTxnQuery;
    public cfxHolderSync: CfxHolderSync;
    public cfxHolderQuery: CfxHolderQuery;
    public tokenSync: TokenSync;
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
    public contractStat: ContractStat;
    public contractRegisterSync: DailyContractRegisterSync
    public contractRegisterQuery: DailyContractRegisterQuery;
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
        // @ts-ignore
        await this.cfx.updateNetworkId();
        const cfxStatus:any = await this.cfx.getStatus()
        StatApp.networkId = cfxStatus.networkId
        StatApp.readonly = this.config.database.readonly
        console.log(`conflux rpc ${this.config.conflux.url}, network id ${StatApp.networkId}`)
        this.tokenTool = new TokenTool(this.cfx);
        // const logger = pino()
        this.sequelize = createDB(this.config.database);
        const {sequelize} = this;
        await this.initRedis();
        await initModel(sequelize);
        if (this.config.database.syncSchema) {
            console.log(`sync model begin.`)
            await sequelize.sync({});
        } else {
            console.log(`skip sync db schema.`)
        }
        this.rankService = new RankService(this)
        this.txnSync = new TxnSync(this, this.sequelize, this.config.conflux);
        this.blockAndMinerSync = new BlockAndMinerSync(sequelize, this.cfx);
        this.traceSync = new BlockTraceSync(this.cfx)
        if (this.config.watchCfxBalance) {
            (this.cfxWatcher = new CfxWatcher('cfx', this.cfx)).schedule(this.config.cfxWatcherDelay).then()
        }
        this.batchBalanceWatcher = new BatchBalanceWatcher(this.cfx, this.config.erc20watchList, this.cfxWatcher)
        this.batchBalanceWatcher.schedule().then()
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
        this.dailyTxnSync = new DailyTxnSync(this.sequelize);
        this.dailyTxnQuery = new DailyTxnQuery();
        this.cfxHolderSync = new CfxHolderSync(this.sequelize);
        this.cfxHolderQuery = new CfxHolderQuery();
        this.tokenSync = new TokenSync(this);
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
        this.contractStat = new ContractStat(this.sequelize);
        this.contractRegisterSync = new DailyContractRegisterSync(this.sequelize);
        this.contractRegisterQuery = new DailyContractRegisterQuery();
        //
        if (this.config.syncBlock) {
            await this.blockAndMinerSync.checkPosition(); // miner block
            await this.blockAndMinerSync.schedule(this.config.syncBlockDelay)
        }
        if (this.config.syncTrace) {
            await this.traceSync.schedule(this.config.syncTraceDelay); // trace
        }
        if (this.config.syncTxn) {
            await this.txnSync.schedule(this.config.syncTxnDelay); // txn
        }
        if (this.config.syncTxnCountDaily) {
            await this.dailyTxnSync.schedule(this.config.syncTxnCountHistory); // dailyTxn
            scheduleDailyActiveAddress()
                .then(()=>{scheduleDailyTokenStat()})
        }
        if (this.config.syncCfxHolderCountDaily) {
            await this.cfxHolderSync.schedule(); // dailyCfxHolder
        }
        if (this.config.syncToken) {
            await this.tokenSync.schedule(); // token from scan
        }
        if (this.config.syncTraceCreateContract) {
            await this.traceCreateSync.schedule(this.config.syncTraceCreateContractDelay); // trace create
        }
        if (this.config.checkRankDelay) {
            let monitor = new Monitor(this.config.dingTalkToken, this.config.serverTag);
            monitor.checkRankDelay().then(()=>{
                monitor.checkFullBlockSyncRunning().then()
            })
        }
        if (this.config.syncContractCreateCountDaily) {
            await this.contractCreateSync.schedule(this.config.syncContractCreateCountHistory); // dailyContractCreate
        }
        if (this.config.syncQuote) {
            await this.quoteSync.schedule(this.config.syncQuoteDelay); // token quote
        }
        if (this.config.syncHomeDashboardData) {
            await this.homeDashboardService.schedule(this.config.syncHomeDashboardDataDelay); // home dash board
        }
        if (this.config.statContractDaily) {
            await this.contractStat.schedule(this.config.syncContractHistory);
        }
        if (this.config.syncEpoch) {
            await this.epochSync.run(this.config.syncEpochNumber);
        }
        if (this.config.syncContractRegisterCountDaily) {
            await this.contractRegisterSync.schedule(this.config.syncContractRegisterCountHistory); // dailyContractRegister
        }
        // Register global process events and graceful shutdown
        // registerProcessEvents(logger, this.sequelize)
    }

}

