import {StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Sequelize} from "sequelize";
// import * as pino from 'pino'
import {TxnSync} from "./service/TxnSync";
import {BlockAndMinerSync} from "./service/BlockAndMinerSync";
import {RankService} from "./service/RankService";
import {Conflux} from "js-conflux-sdk";
import {CfxWatcher, Erc20Watcher} from "./service/watcher/BalanceWatcher";
import {BlockTraceSync} from "./service/BlockTraceSync";
import {BalanceService} from "./service/watcher/BalanceService";
import {ContractService} from "./service/contract/ContractService";
import {ChainWatcher} from "./service/watcher/chain/ChainWatcher";
import {BatchBalanceWatcher} from "./service/watcher/BatchBalanceWatcher";

export class StatApp{
    public config: StatConfig;
    private sequelize: Sequelize;
    public blockAndMinerSync: BlockAndMinerSync;
    public balanceService: BalanceService;
    public rankService: RankService;
    public txnSync: TxnSync;
    public traceSync: BlockTraceSync
    public cfx: Conflux;
    public contractService: ContractService;
    private batchBalanceWatcher: BatchBalanceWatcher;
    constructor(config: StatConfig) {
        this.config = config;
    }

    public async init() {
        this.cfx = new Conflux(this.config.conflux)
        // @ts-ignore
        await this.cfx.updateNetworkId();
        // const logger = pino()
        this.sequelize = createDB(this.config.database);
        const {sequelize} = this;
        await initModel(sequelize);
        if (this.config.database.syncSchema) {
            console.log(`sync model begin.`)
            await sequelize.sync({});
        } else {
            console.log(`skip sync db schema.`)
        }
        this.rankService = new RankService(this.sequelize)
        this.txnSync = new TxnSync(this.sequelize, this.config.conflux);
        this.blockAndMinerSync = new BlockAndMinerSync(sequelize, this.cfx);
        // @ts-ignore
        this.cfx.networkId = this.cfx.networkId || this.cfx.chainId
        // @ts-ignore
        const networkId = this.cfx.networkId
        this.traceSync = new BlockTraceSync(this.cfx)
        this.config.erc20watchList.forEach(erc20=>{
            const watcher = new Erc20Watcher(erc20.name, erc20.address, this.cfx, this.config)
            watcher.schedule(erc20.watchDelay, erc20.tokenType)
        })
        this.batchBalanceWatcher = new BatchBalanceWatcher(this.cfx, this.config.erc20watchList)
        this.batchBalanceWatcher.schedule().then()
        // @ts-ignore
        this.balanceService = new BalanceService(this.config.erc20watchList, this.cfx.networkId)
        this.balanceService.schedule(3000)
        new ChainWatcher().watchPivotSwitch({cfxWsUrl: this.config.cfxWsUrl}).then()
        //
        this.contractService = new ContractService(this.config.scanApiUrl, networkId)
        this.contractService.schedule()
        if (this.config.watchCfxBalance) {
            new CfxWatcher('cfx', this.cfx, this.config).schedule(this.config.cfxWatcherDelay).then()
        }
        // @ts-ignore
        console.log(`conflux rpc ${this.config.conflux.url}, network id ${this.cfx.networkId}`)
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
        // Register global process events and graceful shutdown
        // registerProcessEvents(logger, this.sequelize)
    }

}

