import {loadConfig, StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Sequelize} from "sequelize";
import {Conflux} from "js-conflux-sdk";
import {initOss, TokenTool} from "./service/tool/TokenTool";
import {TokenQuery} from "./service/TokenQuery";
import {EpochSync} from "./service/EpochSync";
import {initCfxSdk, patchFormat} from "./service/common/utils";
import {IS_EVM2, KV} from "./model/KV";
import {StatApp} from "./StatApp";
import {ContractQuery} from "./service/ContractQuery";
import {redirectLog} from "./config/LoggerConfig";
import {makeIdV} from "./model/HexMap";
import {CONST} from "./service/common/constant";

patchFormat();

export class FullEpochSync{
    public config: StatConfig;
    public cfx: Conflux;
    public sequelize: Sequelize;
    public tokenTool: TokenTool;
    public tokenQuery: TokenQuery;
    public contractQuery: ContractQuery;
    public epochSync: EpochSync;
    public zeroAddressId: number;

    constructor(config: StatConfig) {
        this.config = config;
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
    }

    public async run() {
        this.cfx = await initCfxSdk(this.config.conflux);
        StatApp.networkId = this.cfx.networkId;
        await Promise.all([
            this.initDb(),
            initOss(this.config.oss)
        ]);
        await this.initSwitch();

        this.tokenTool = new TokenTool(this.cfx);
        this.tokenQuery = new TokenQuery(this);
        this.contractQuery = new ContractQuery(this);
        this.zeroAddressId = await makeIdV(CONST.ZERO_ADDRESS);
        this.epochSync = new EpochSync(this);

        await this.epochSync.mustInit()
        await this.epochSync.run(this.config.syncEpochNumber)
        await this.epochSync.startRealtimeStat()
    }

    public async close() {
        await KV.sequelize.close();
    }
}

async function start() {
    const config = loadConfig('Prod');
    redirectLog({mainPath: 'EpochSync'});
    const server = new FullEpochSync(config);
    registerProcessHook(server);
    await server.run();
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
    start().then();
}
