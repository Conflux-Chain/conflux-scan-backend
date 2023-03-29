import {loadConfig, StatConfig} from "./config/StatConfig";
import {createDB, initModel} from "./service/DBProvider";
import {Sequelize} from "sequelize";
import {Conflux} from "js-conflux-sdk";
import {TokenTool} from "./service/tool/TokenTool";
import {patchFormat, patchHttpProvider} from "./service/common/utils";
import {IS_EVM2, KV} from "./model/KV";
import {StatApp} from "./StatApp";
import {EpochNftTransferSync} from "./service/EpochNftTransferSync";
import {makeIdV} from "./model/HexMap";
import {CONST} from "./service/common/constant";

patchFormat();

export class FullEpochNftTransferSync{
    public config: StatConfig;
    public cfx: Conflux;
    public sequelize: Sequelize;
    public tokenTool: TokenTool;
    public epochSync: EpochNftTransferSync;
    public zeroAddressId: number;

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
        await this.initCfxSdk();
        await Promise.all([
            this.initDb(),
        ]);
        await this.initSwitch();

        this.tokenTool = new TokenTool(this.cfx);
        this.epochSync = new EpochNftTransferSync(this);
        this.zeroAddressId = await makeIdV(CONST.ZERO_ADDRESS);

        await this.epochSync.run(this.config.syncEpochNumber);
        // await this.epochSync.syncAddressNft();
    }

    public async close() {
        await KV.sequelize.close();
    }
}

async function start() {
    const config = loadConfig('Prod');
    const server = new FullEpochNftTransferSync(config);
    await server.run();
    registerProcessHook(server);
}

function registerProcessHook(server: FullEpochNftTransferSync) {
    process.on('SIGINT', exitOnSignal(server));
    process.on('SIGTERM', exitOnSignal(server));
}

function exitOnSignal(server: FullEpochNftTransferSync) {
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
