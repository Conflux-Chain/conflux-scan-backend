import {StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Sequelize} from "sequelize";
// import * as pino from 'pino'
import {TxnSync} from "./service/TxnSync";
import {BlockAndMinerSync} from "./service/BlockAndMinerSync";
import {RankService} from "./service/RankService";
import {Conflux} from "js-conflux-sdk";
import {Erc20Watcher} from "./service/watcher/BalanceWatcher";

export class StatApp{
    public config: StatConfig;
    private sequelize: Sequelize;
    public blockAndMinerSync: BlockAndMinerSync;
    public rankService: RankService;
    public txnSync: TxnSync;
    public cfx: Conflux;
    constructor(config: StatConfig) {
        this.config = config;
    }

    public async init() {
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
        this.blockAndMinerSync = new BlockAndMinerSync(sequelize, this.config.conflux);
        this.cfx = new Conflux(this.config.conflux)
        this.config.erc20watchList.forEach(erc20=>{
            const watcher = new Erc20Watcher(erc20.name, erc20.address, this.cfx)
            watcher.schedule(erc20.watchDelay)
        })
        // @ts-ignore
        await this.cfx.updateNetworkId();
        // @ts-ignore
        this.cfx.networkId = this.cfx.networkId || this.cfx.chainId
        // @ts-ignore
        console.log(`conflux rpc ${this.config.conflux.url}, network id ${this.cfx.networkId}`)
        //
        if (this.config.syncBlock) {
            await this.blockAndMinerSync.checkPosition(); // miner block
            await this.blockAndMinerSync.schedule(this.config.syncBlockDelay)
        }
        if (this.config.syncTxn) {
            await this.txnSync.schedule(this.config.syncTxnDelay); // txn
        }
        // Register global process events and graceful shutdown
        // registerProcessEvents(logger, this.sequelize)
    }

}

