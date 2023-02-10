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
import {ContractQuery} from "./service/ContractQuery";
import {SyncBase} from "./service/SyncBase";

patchFormat();

export class FullEpochSync{
    public config: StatConfig;
    public cfx: Conflux;
    public sequelize: Sequelize;
    public tokenTool: TokenTool;
    public tokenQuery: TokenQuery;
    public contractQuery: ContractQuery;
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

        StatNotifier.SWITCH_STREAM_STAT = this.config.streamStat;
        StatNotifier.SWITCH_STAT_TOKEN_TRANSFER = this.config.statTokenTransfer;
        StatNotifier.SWITCH_STAT_DAILY_TOKEN_TRANSFER = this.config.statDailyTokenTransfer;
        StatNotifier.SWITCH_STAT_NFT_MINT = this.config.statNFTMint;
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
        this.contractQuery = new ContractQuery(this);
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

if (module === require.main) {
    if (process.argv.includes('backward')) {
        SyncBase.SYNC_BACKWARD = true;
        EpochSync.SYNC_EPOCH = process.argv.includes('syncEpoch');
        EpochSync.SYNC_BLOCK = process.argv.includes('syncBlock');
        EpochSync.SYNC_ANNOUNCE = process.argv.includes('syncAnnounce');
        EpochSync.SYNC_TRACE = process.argv.includes('syncTrace');
        EpochSync.SYNC_TRANSFER = process.argv.includes('syncTransfer');
        EpochSync.SYNC_DESTROY = process.argv.includes('syncDestroy');
        EpochSync.SYNC_TOKEN_DETECT = process.argv.includes('syncTokenDetect');
        EpochSync.SYNC_TOKEN_AUDIT = process.argv.includes('syncTokenAudit');
        EpochSync.SYNC_TOKEN_ICON = process.argv.includes('syncTokenIcon');
        EpochSync.SYNC_VERIFY_LINK = process.argv.includes('syncVerifyLink');
        EpochSync.SYNC_EVM_ADDR = process.argv.includes('syncEvmAddr');
    }
    if (process.argv.includes('prune')) {
        PruneNotifier.SWITCH_SYNC_PRUNE = true;
    }
    start().then();
}
