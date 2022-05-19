import {loadConfig, StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Sequelize} from "sequelize";
import {Conflux} from "js-conflux-sdk";
import {initOss, TokenTool} from "./service/tool/TokenTool";
import {TokenQuery} from "./service/TokenQuery";
import {EpochSync} from "./service/EpochSync";
import {redisWrap, RedisWrap} from "./service/RedisWrap";
import {patchFormat, patchHttpProvider} from "./service/common/utils";
import {IS_EVM2, KEY_TPS_TRANSFER_NOTIFY, KV} from "./model/KV";
import {StatNotifier} from "./service/streamstat/StatNotifier";
import {StatApp} from "./StatApp";
import {PruneNotifier} from "./service/prune/PruneNotifier";
import {PruneHandler} from "./service/prune/PruneHandler";
import {TransferTpsService} from "./service/TransferTpsService";

patchFormat();

export class FullEpochSync{
    public config: StatConfig;
    public cfx: Conflux;
    public sequelize: Sequelize;
    public tokenTool: TokenTool;
    public tokenQuery: TokenQuery;
    public epochSync: EpochSync;
    public pruneHandler: PruneHandler;
    public transferTpsService: TransferTpsService;

    constructor(config: StatConfig) {
        this.config = config;
    }

    private async initCfxSdk() {
        this.cfx = new Conflux({...this.config.conflux});
        patchHttpProvider(this.cfx, this.config.conflux, 'StatApp');

        await this.cfx.updateNetworkId();
        const cfxStatus: any = await this.cfx.getStatus();
        StatApp.networkId = cfxStatus.networkId;
        console.log(`conflux network id:${StatApp.networkId}, config:${JSON.stringify(this.config.conflux)}`);
    }

    private async initRedis() {
        let redisConf = this.config.redis;
        return RedisWrap.connect(redisConf);
    }

    private async initDb(){
        StatApp.readonly = this.config.database.readonly;

        this.sequelize = createDB(this.config.databaseRW);
        await initModel(this.sequelize);

        if (this.config.database.syncSchema) {
            console.log(`sync model begin...`);
            await this.sequelize.sync({});
            console.log(`sync model finished.`);
        } else {
            console.log(`skip sync db schema.`);
        }
    }

    private async initSwitch(){
        KV.setupSwitch().then();

        StatApp.isEVM = await KV.getSwitch(IS_EVM2);
        TransferTpsService.TPS_TRANSFER_NOTIFY = await KV.getSwitch(KEY_TPS_TRANSFER_NOTIFY);

        PruneNotifier.SWITCH_SYNC_PRUNE = this.config.syncPrune; // prune block
        StatNotifier.SWITCH_STREAM_STAT = this.config.streamStat;
        StatNotifier.SWITCH_STAT_TOKEN_TRANSFER = this.config.statTokenTransfer;
        StatNotifier.SWITCH_STAT_DAILY_TOKEN_TRANSFER = this.config.statDailyTokenTransfer;
    }

    public async run() {
        await this.initCfxSdk();
        await Promise.all([
            this.initRedis(),
            this.initDb(),
            initOss(this.config.oss)
        ]);
        await this.initSwitch();

        this.tokenTool = new TokenTool(this.cfx);
        this.tokenQuery = new TokenQuery(this);
        this.epochSync = new EpochSync(this);

        await this.epochSync.run(this.config.syncEpochNumber);
    }

    public async close() {
        await KV.sequelize.close();
        await redisWrap.client.end(false);
    }
}

async function start() {
    const config = loadConfig('Prod');
    const server = new FullEpochSync(config);
    await server.run();
    registerProcessHook(server);
}

function registerProcessHook(server: FullEpochSync) {
    process.on('SIGINT', exitOnSignal(server));
    process.on('SIGTERM', exitOnSignal(server));
}

function exitOnSignal(server: FullEpochSync) {
    return async (signal) => {
        console.log(`receive ${signal}...`);
        await server.close();
        console.log(`server shutdown.`);
        process.exit(0);
    }
}

start().then();
