import {StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Sequelize} from "sequelize";
import * as pino from 'pino'
import {TxnSync} from "./service/TxnSync";
import {BlockAndMinerSync} from "./service/BlockAndMinerSync";
import {Provider, providerFactory} from "js-conflux-sdk";

export class StatApp{
    private config: StatConfig;
    private sequelize: Sequelize;
    public blockService: BlockAndMinerSync;
    public dataPorter: TxnSync;
    private scanApi: Provider;
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
        this.dataPorter = new TxnSync(this.sequelize, this.config.conflux);
        this.blockService = new BlockAndMinerSync(sequelize, this.config.conflux);
        this.scanApi = providerFactory({ url: this.config.scanApiUrl });
        //
        await this.blockService.checkPosition(); // miner block
        await this.dataPorter.schedule(); // txn
        await this.blockService.schedule(this.scanApi)
        // Register global process events and graceful shutdown
        // registerProcessEvents(logger, this.sequelize)
    }

}

