import {StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Sequelize} from "sequelize";
import {TxnSync} from "./service/TxnSync";
import {RankService} from "./service/RankService";
import {Conflux, format} from "js-conflux-sdk";
import {initOss, TokenTool} from "./service/tool/TokenTool";
import {CfxWatcher} from "./service/watcher/BalanceWatcher";
import {BalanceService} from "./service/watcher/BalanceService";
import {ContractService} from "./service/contract/ContractService";
import {ChainWatcher} from "./service/watcher/chain/ChainWatcher";
import {BatchBalanceWatcher} from "./service/watcher/BatchBalanceWatcher";
import {DailyTxnQuery} from "./service/DailyTxnQuery";
import {CfxHolderQuery} from "./service/CfxHolderQuery";
import {TokenQuery} from "./service/TokenQuery";
import {BlockTraceCreateQuery} from "./service/BlockTraceCreateQuery";
import {DailyContractCreateQuery} from "./service/DailyContractCreateQuery";
import {ReportService} from "./service/ReportService";
import {RedisWrap} from "./service/RedisWrap";
import {QuoteSync} from "./service/QuoteSync";
import {IPFSGatewaySync} from "./service/IPFSGatewaySync";
import {HomeDashboardService} from "./service/HomeDashboardService";
import {ContractQuery} from "./service/ContractQuery";
import {DailyContractStatQuery} from "./service/DailyContractStatQuery";
import {DailyContractRegisterQuery} from "./service/DailyContractRegisterQuery";
import {DailyBlockDataStatQuery} from "./service/DailyBlockDataStatQuery";
import {NFTPreviewService} from "./service/nftchecker/NFTPreviewService";
import {NFTCheckerService} from "./service/nftchecker/NFTCheckerService";
import {TokenSecurityAuditSync} from "./service/TokenSecurityAuditSync";
import {PruneHandler} from "./service/prune/PruneHandler";
import {initCfxSdk, patchFormat} from "./service/common/utils";
import {IS_EVM2, KEY_FASTEST_IPFS_GATEWAY, KEY_FULL_STATE_RPC, KV} from "./model/KV";
import {PosQuery} from "./service/pos/PosQuery";
import {TransferTpsService} from "./service/TransferTpsService";
import {PowSidePosSync} from "./service/pos/PowSidePosSync";
import {Desensitizer} from "./service/Desensitizer";
import {FullBlockQuery} from "./service/FullBlockQuery";
import {ENSCheckerQuery} from "./service/ens/ENSCheckerQuery";
import {AccountQuery} from "./service/AccountQuery";
patchFormat();
export class StatApp{
    public config: StatConfig;
    public sequelize: Sequelize;
    public balanceService: BalanceService;
    public rankService: RankService;
    public txnSync: TxnSync;
    public cfx: Conflux;
    public fullStateCfx: Conflux;
    public contractService: ContractService;
    public batchBalanceWatcher: BatchBalanceWatcher;
    public cfxWatcher:CfxWatcher;
    public posQuery: PosQuery
    public dailyTxnQuery: DailyTxnQuery;
    public cfxHolderQuery: CfxHolderQuery;
    public tokenQuery: TokenQuery;
    public traceCreateQuery: BlockTraceCreateQuery;
    public contractCreateQuery: DailyContractCreateQuery;
    public siteVerify: ReportService;
    public quoteSync: QuoteSync;
    public ipfsGatewaySync: IPFSGatewaySync;
    public homeDashboardService: HomeDashboardService;
    public contractQuery: ContractQuery;
    public contractStatQuery: DailyContractStatQuery;
    public contractRegisterQuery: DailyContractRegisterQuery;
    public blockDataStatQuery: DailyBlockDataStatQuery;
    public nftPreviewService: NFTPreviewService;
    public nftCheckerService: NFTCheckerService;
    public tokenSecurityAuditSync: TokenSecurityAuditSync;
    public pruneHandler: PruneHandler;
    public transferTpsService: TransferTpsService;
    public fullBlockQuery: FullBlockQuery;
    public ensCheckerQuery: ENSCheckerQuery;
    public accountQuery: AccountQuery;
    public desensitizer: Desensitizer;
    public tokenTool: TokenTool;
    public static networkId = 1029
    public static readonly = false
    public static isEVM = false;
    constructor(config: StatConfig) {
        this.config = config;
    }
    public async initRedis() {
        let redisConf = this.config.redis;
        return RedisWrap.connect(redisConf)
    }
    public async init() {
        this.cfx = await initCfxSdk(this.config.conflux);
        StatApp.networkId = this.cfx.networkId
        let fullStageRpc = await KV.getString(KEY_FULL_STATE_RPC, "");
        if (fullStageRpc) {
            this.fullStateCfx = await initCfxSdk({url: fullStageRpc});
        } else {
            console.log(`config not found for ${KEY_FULL_STATE_RPC}`);
            this.fullStateCfx = this.cfx;
        }
        PowSidePosSync.POS_CONTRACT_VERBOSE = format.address(PowSidePosSync.POS_CONTRACT_HEX, StatApp.networkId, true)
        StatApp.readonly = this.config.database.readonly
        console.log(`conflux network id ${StatApp.networkId}, config:`, this.config.conflux)
        this.tokenTool = new TokenTool(this.cfx);
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
        StatApp.isEVM = await KV.getSwitch(IS_EVM2);
        this.txnSync = new TxnSync(this);
        const utilContract = await BatchBalanceWatcher.getUtilContractAddr();
        if (this.config.watchCfxBalance) {
            (this.cfxWatcher = new CfxWatcher('cfx', this.cfx))
            this.batchBalanceWatcher = new BatchBalanceWatcher(this.cfx, this.cfxWatcher, utilContract)
        }
        // @ts-ignore
        this.balanceService = new BalanceService(this, [], StatApp.networkId)
        this.balanceService.schedule(60_000)
        new ChainWatcher().watchPivotSwitch({cfxWsUrl: this.config.cfxWsUrl}).then()
        this.contractService = new ContractService(this.config.scanApiUrl, StatApp.networkId)
        this.contractService.schedule()
        this.dailyTxnQuery = new DailyTxnQuery();
        this.posQuery = new PosQuery(this.cfx);
        this.cfxHolderQuery = new CfxHolderQuery();
        this.tokenQuery = new TokenQuery(this);
        this.traceCreateQuery = new BlockTraceCreateQuery(this);
        this.contractCreateQuery = new DailyContractCreateQuery();
        this.siteVerify = new ReportService(this);
        this.quoteSync = new QuoteSync(this);
        this.ipfsGatewaySync = new IPFSGatewaySync(this);
        this.homeDashboardService = new HomeDashboardService(this);
        this.contractQuery = new ContractQuery(this);
        this.contractStatQuery = new DailyContractStatQuery();
        this.contractRegisterQuery = new DailyContractRegisterQuery();
        this.blockDataStatQuery = new DailyBlockDataStatQuery(null);
        this.nftPreviewService = new NFTPreviewService(this);
        this.nftCheckerService = new NFTCheckerService(this, utilContract);
        this.tokenSecurityAuditSync = new TokenSecurityAuditSync(this);
        this.pruneHandler = new PruneHandler(this);
        this.transferTpsService = new TransferTpsService(this);
        this.desensitizer = new Desensitizer(this);
        this.rankService = new RankService(this)
        this.fullBlockQuery = new FullBlockQuery(this);
        this.ensCheckerQuery = new ENSCheckerQuery(this);
        this.accountQuery = new AccountQuery(this);
        this.txnSync.scheduleCache()
        if (this.config.syncQuote) {
            await this.quoteSync.schedule();
        }
        if (this.config.syncIPFSGateway) {
            IPFSGatewaySync.fastest = await KV.getString(KEY_FASTEST_IPFS_GATEWAY, '');
            await this.ipfsGatewaySync.schedule(this.config.syncIPFSGatewayDelay);
        }
        if (this.config.syncRecommendGasPrice) {
            await this.fullBlockQuery.schedule();
        }
        if (this.config.syncTokenSecurityAudit) {
            await this.tokenSecurityAuditSync.schedule();
        }
        if (this.config.syncTransferTps) {
            await this.transferTpsService.scheduleRefreshConfig();
            await this.transferTpsService.schedule();
        }
        if(this.config.blacklist) {
            await this.desensitizer.scheduleRefreshBlacklist();
        }
        // Register global process events and graceful shutdown
        // registerProcessEvents(logger, this.sequelize)
    }
}
