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
import {TokenQuery} from "./service/TokenQuery";
import {ContractTraceCreateQuery} from "./service/ContractTraceCreateQuery";
import {IPFSGatewaySync} from "./service/IPFSGatewaySync";
import {HomeDashboardService} from "./service/HomeDashboardService";
import {ContractQuery} from "./service/ContractQuery";
import {StatsQuery} from "./service/StatsQuery";
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
    public tokenQuery: TokenQuery;
    public traceCreateQuery: ContractTraceCreateQuery;
    public ipfsGatewaySync: IPFSGatewaySync;
    public homeDashboardService: HomeDashboardService;
    public contractQuery: ContractQuery;
    public statsQuery: StatsQuery;
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
            this.cfxWatcher = new CfxWatcher('cfx', this.cfx);
        }
        this.batchBalanceWatcher = new BatchBalanceWatcher(this.cfx, utilContract)
        // @ts-ignore
        this.balanceService = new BalanceService(this, StatApp.networkId)
        new ChainWatcher().watchPivotSwitch({cfxWsUrl: this.config.cfxWsUrl}).then()
        this.posQuery = new PosQuery(this.cfx);
        this.tokenQuery = new TokenQuery(this);
        this.traceCreateQuery = new ContractTraceCreateQuery(this);
        this.ipfsGatewaySync = new IPFSGatewaySync();
        this.contractQuery = new ContractQuery(this);
        this.statsQuery = new StatsQuery(this);
        this.nftPreviewService = new NFTPreviewService(this);
        this.nftCheckerService = new NFTCheckerService(this);
        this.desensitizer = new Desensitizer();
        this.rankService = new RankService(this)
        this.rankService.repeatUpdateTxnCache(); // scheduleCache
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
        this.txnQuery.scheduleCache().then()
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
