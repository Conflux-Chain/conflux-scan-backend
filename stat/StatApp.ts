import {StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Sequelize} from "sequelize";
import * as pino from 'pino'
import {TxnSync} from "./service/TxnSync";
import {BlockAndMinerSync} from "./service/BlockAndMinerSync";

export class StatApp{
    private config: StatConfig;
    private sequelize: Sequelize;
    public blockAndMinerSync: BlockAndMinerSync;
    public txnSync: TxnSync;
    constructor(config: StatConfig) {
        this.config = config;
    }

    public async init() {
        const logger = pino()
        this.sequelize = createDB(this.config.database);
        const {sequelize} = this;
        logger.info('sequelize is ' + sequelize)
        await initModel(sequelize);
        await sequelize.sync({});
        this.txnSync = new TxnSync(this.sequelize, this.config.conflux);
        this.blockAndMinerSync = new BlockAndMinerSync(sequelize, this.config.conflux);
        //
        await this.blockAndMinerSync.checkPosition(); // miner block
        await this.txnSync.schedule(); // txn
        await this.blockAndMinerSync.schedule()
        // Register global process events and graceful shutdown
        // registerProcessEvents(logger, this.sequelize)
    }

}

