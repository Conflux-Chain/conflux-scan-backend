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

const fs = require('fs');
const path = require('path');
const v8Profiler = require('v8-profiler-next');
const heapdump = require('heapdump');

const fileName = path.basename(__filename)
const extName = path.extname(__filename)
const tag = fileName.substr(0, fileName.length - extName.length)

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
        StatApp.readonly = this.config.database?.readonly;

        this.sequelize = createDB(this.config.databaseRW);
        await initModel(this.sequelize);
        if (this.config.database?.syncSchema) {
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
        await this.epochSync.scheduleLatestEpoch()
        await this.epochSync.scheduleEvict()
        await this.epochSync.startRealtimeStat()
        await this.epochSync.run()
    }

    public async close() {
        await KV.sequelize.close();
    }
}

async function start() {
    redirectLog({mainPath: tag});

    const config = loadConfig('Prod');

    const server = new FullEpochSync(config);
    registerProcessHook(server);
    await server.run();

    if (config?.enableProfile) {
        profile()
        heapDump()
    }
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

function profile(delay = 10 * 60 * 1000) {
    console.log(`schedule cpu profiling, interval: ${delay}`)
    const dest = `${path.dirname(__filename)}/${tag}.cpuprofile`

    v8Profiler.setGenerateType(1)
    v8Profiler.startProfiling(tag, true)

    setTimeout(() => {
        const profile = v8Profiler.stopProfiling(tag)

        profile.export(function (error, result) {
            fs.writeFileSync(dest, result)
            profile.delete()
        })

        console.log(`cpu profile writen to ${dest}`)
    }, delay)
}

function heapDump(delay = 10 * 60 * 1000) {
    console.log(`schedule heap dump, interval: ${delay}`)
    const dest = `${path.dirname(__filename)}/${tag}.heapsnapshot`

    setTimeout(() => {
        heapdump.writeSnapshot(dest)
        console.log(`heap dump writen to ${dest}`)
    }, delay)
}

if (module === require.main) {
    start().then();
}
