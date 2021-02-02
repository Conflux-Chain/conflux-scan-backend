import {StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Sequelize} from "sequelize";
// import * as pino from 'pino'
import {TxnSync} from "./service/TxnSync";
import {BlockAndMinerSync} from "./service/BlockAndMinerSync";
import {RankService} from "./service/RankService";
import {Conflux} from "js-conflux-sdk";

export class StatApp{
    private config: StatConfig;
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
        await sequelize.sync({});
        this.rankService = new RankService(this.sequelize)
        this.txnSync = new TxnSync(this.sequelize, this.config.conflux);
        this.blockAndMinerSync = new BlockAndMinerSync(sequelize, this.config.conflux);
        this.cfx = new Conflux(this.config.conflux)
        // @ts-ignore
        await this.cfx.updateNetworkId();
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

