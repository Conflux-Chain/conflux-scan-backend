import {Server} from 'http'
import {redirectLog} from "./service/tool/LoggerConfig";
import {loadConfig, StatConfig} from "./config/StatConfig";
import {registerConsortiumRouter} from "./router/ConsortiumBridgeRouter";
import {initCfxSdk} from "./service/common/utils";
import {Conflux} from "js-conflux-sdk";

const Koa = require('koa');
const app = new Koa();

let consortiumService: ConsortiumService;

export function getConsortiumService() {
    return consortiumService;
}

export class ConsortiumService {
    public config: StatConfig;
    public cfx: Conflux;
    public static networkId = 1029

    constructor(config: StatConfig) {
        this.config = config;
    }

    public async init() {
        this.cfx = await initCfxSdk(this.config.consortiumBridge.rpc);
        ConsortiumService.networkId = this.cfx.networkId;

        // check available
        const status =  await this.cfx.getStatus();
        console.log(`conflux status`, status);
    }
}

export async function init() {
    redirectLog({mainPath:'consortium-bridge'});
    console.log(`${new Date().toISOString()}=======start consortium bridge=======`);

    const config = loadConfig('Prod');
    consortiumService = new ConsortiumService(config);
    await consortiumService.init();

    registerConsortiumRouter(app);
    const server = app.listen(config?.consortiumBridge?.port || 12551);

    regProcessHook(server);
}

function regProcessHook(server: Server) {
    process.on('SIGINT', exitOnSignal(server));
    process.on('SIGTERM', exitOnSignal(server));
}

function exitOnSignal(server: Server) {
    return async (signal) => {
        console.log(`receive ${signal}`);
        await server.close();
        console.log(`server shutdown.`);
        process.exit(0);
    }
}

if (module === require.main) {
    init().then();
}