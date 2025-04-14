import {StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Sequelize} from "sequelize";
import {TxnSync} from "./service/TxnSync";
import {RankService} from "./service/RankService";
import {Conflux, format} from "js-conflux-sdk";
import {initOss, TokenTool} from "./service/tool/TokenTool";
import {CfxWatcher} from "./service/watcher/BalanceWatcher";
import {BalanceService} from "./service/watcher/BalanceService";
import {ChainWatcher} from "./service/watcher/chain/ChainWatcher";
import {BatchBalanceWatcher} from "./service/watcher/BatchBalanceWatcher";
import {DailyTxnQuery} from "./service/DailyTxnQuery";
import {CfxHolderQuery} from "./service/CfxHolderQuery";
import {TokenQuery} from "./service/TokenQuery";
import {BlockTraceCreateQuery} from "./service/BlockTraceCreateQuery";
import {ReportService} from "./service/ReportService";
import {IPFSGatewaySync} from "./service/IPFSGatewaySync";
import {HomeDashboardService} from "./service/HomeDashboardService";
import {ContractQuery} from "./service/ContractQuery";
import {DailyContractStatQuery} from "./service/DailyContractStatQuery";
import {DailyBlockDataStatQuery} from "./service/DailyBlockDataStatQuery";
import {NFTPreviewService} from "./service/nftchecker/NFTPreviewService";
import {NFTCheckerService} from "./service/nftchecker/NFTCheckerService";
import {initCfxSdk, initEthSdk} from "./service/common/utils";
import {
    IS_EVM2,
    KEY_FASTEST_IPFS_GATEWAY,
    KEY_FULL_STATE_RPC,
    KV
} from "./model/KV";
import {PosQuery} from "./service/pos/PosQuery";
import {PowSidePosSync} from "./service/pos/PowSidePosSync";
import {Desensitizer} from "./service/Desensitizer";
import {FullBlockQuery} from "./service/FullBlockQuery";
import {ENSCheckerQuery} from "./service/ens/ENSCheckerQuery";
import {AccountQuery} from "./service/AccountQuery";
import {JsonRpcProvider} from "@ethersproject/providers/src.ts/json-rpc-provider";
import {StatOnRealtime} from "./service/timerstat/StatOnRealtime"
import {TxnQuery} from "./service/TxnQuery";
import {ethers} from "ethers";

export var CoreSpaceRpc: Conflux = null;

export class StatApp{
    public config: StatConfig;
    public sequelize: Sequelize;
    public balanceService: BalanceService;
    public rankService: RankService;
    public txnSync: TxnSync;
    public cfx: Conflux;
    public eth: JsonRpcProvider;
    public fullStateCfx: Conflux;
    public batchBalanceWatcher: BatchBalanceWatcher;
    public cfxWatcher:CfxWatcher;
    public posQuery: PosQuery
    public dailyTxnQuery: DailyTxnQuery;
    public cfxHolderQuery: CfxHolderQuery;
    public tokenQuery: TokenQuery;
    public traceCreateQuery: BlockTraceCreateQuery;
    public siteVerify: ReportService;
    public ipfsGatewaySync: IPFSGatewaySync;
    public homeDashboardService: HomeDashboardService;
    public contractQuery: ContractQuery;
    public contractStatQuery: DailyContractStatQuery;
    public blockDataStatQuery: DailyBlockDataStatQuery;
    public nftPreviewService: NFTPreviewService;
    public nftCheckerService: NFTCheckerService;
    public fullBlockQuery: FullBlockQuery;
    public ensCheckerQuery: ENSCheckerQuery;
    public accountQuery: AccountQuery;
    public desensitizer: Desensitizer;
    public tokenTool: TokenTool;
    public statOnRealtime: StatOnRealtime
    public txnQuery: TxnQuery
    public static networkId = 1029
    public static readonly = false
    public static isEVM = false;
    public static epochCIP1559Enabled // Epoch number at which CIP1559 is enabled.
    constructor(config: StatConfig) {
        this.config = config;
    }

    public async init() {
        this.cfx = await initCfxSdk(this.config.conflux);
        this.eth = initEthSdk(this.config.ether?.url);
        StatApp.networkId = this.cfx.networkId
        PowSidePosSync.POS_CONTRACT_VERBOSE = format.address(PowSidePosSync.POS_CONTRACT_HEX, StatApp.networkId, true)
        StatApp.readonly = this.config.database.readonly
        console.log(`conflux network id ${StatApp.networkId}, config:`, this.config.conflux)
        this.tokenTool = new TokenTool(this.cfx);
        this.sequelize = createDB(this.config.databaseRW);
        const {sequelize} = this;
        await Promise.all([
            initModel(sequelize),
            initOss(this.config.oss)
        ])
        if (this.config.database?.syncSchema) {
            console.log(`sync model begin.`)
            await sequelize.sync({});
        } else {
            console.log(`skip sync db schema.`)
        }
        StatApp.isEVM = await KV.getSwitch(IS_EVM2);
        if (StatApp.isEVM && this.config.conflux2) {
            CoreSpaceRpc = await initCfxSdk(this.config.conflux2);
        }
        this.txnSync = new TxnSync(this);
        const utilContract = await BatchBalanceWatcher.getUtilContractAddr();
        if (this.config.watchCfxBalance) {
            (this.cfxWatcher = new CfxWatcher('cfx', this.cfx))
            this.batchBalanceWatcher = new BatchBalanceWatcher(this.cfx, utilContract)
        }
        // @ts-ignore
        this.balanceService = new BalanceService(this, StatApp.networkId)
        this.balanceService.schedule(60_000)
        new ChainWatcher().watchPivotSwitch({cfxWsUrl: this.config.cfxWsUrl}).then()
        this.dailyTxnQuery = new DailyTxnQuery();
        this.posQuery = new PosQuery(this.cfx);
        this.cfxHolderQuery = new CfxHolderQuery();
        this.tokenQuery = new TokenQuery(this);
        this.traceCreateQuery = new BlockTraceCreateQuery(this);
        this.siteVerify = new ReportService(this);
        this.ipfsGatewaySync = new IPFSGatewaySync();
        this.homeDashboardService = new HomeDashboardService(this);
        this.contractQuery = new ContractQuery(this);
        this.contractStatQuery = new DailyContractStatQuery();
        this.blockDataStatQuery = new DailyBlockDataStatQuery(null);
        this.nftPreviewService = new NFTPreviewService(this);
        this.nftCheckerService = new NFTCheckerService(this, utilContract);
        this.desensitizer = new Desensitizer(this);
        this.rankService = new RankService(this)
        this.fullBlockQuery = new FullBlockQuery(this);
        this.ensCheckerQuery = new ENSCheckerQuery(this);
        this.accountQuery = new AccountQuery(this);
        this.statOnRealtime = new StatOnRealtime()
        this.txnQuery = new TxnQuery()
        this.txnSync.scheduleCache()
        if (this.config.syncIPFSGateway) {
            IPFSGatewaySync.fastest = await KV.getString(KEY_FASTEST_IPFS_GATEWAY, '');
            await this.ipfsGatewaySync.schedule(this.config.syncIPFSGatewayDelay);
        }
        if(this.config.blacklist) {
            await this.desensitizer.scheduleRefreshBlacklist();
        }
        await this.txnQuery.scheduleCache()
        let fullStateRpc = await KV.getString(KEY_FULL_STATE_RPC, "");
        if (fullStateRpc) {
            this.fullStateCfx = await initCfxSdk({url: fullStateRpc}).catch(e=>{
                console.log(`failed to init fullStateRpc ${fullStateRpc}`, e)
                process.exit(9)
            });
        } else {
            console.log(`config not found for ${KEY_FULL_STATE_RPC}`);
            this.fullStateCfx = this.cfx;
        }
        // Register global process events and graceful shutdown
        // registerProcessEvents(logger, this.sequelize)
    }
}

export function fmtAddr(hex: string, netId: number, verbose = false) {
    if (!hex) {
        return hex
    }
    if (StatApp.isEVM) {
        if (hex.includes(":")) {
            hex = format.hexAddress(hex)
        }
        return ethers.utils.getAddress(hex);
    }
    return format.address(hex, netId, verbose)
}
