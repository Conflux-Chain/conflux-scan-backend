import {Conflux} from "js-conflux-sdk";

const Koa = require('koa');
const app = new Koa();
import {loadConfig, StatConfig} from "../stat/config/StatConfig";
import {patchHttpProvider} from "../stat/service/common/utils";
import {StatApp} from "../stat/StatApp";
import {createDB} from "../stat/service/DBProvider";
import {RedisWrap} from "../stat/service/RedisWrap";
import {register} from "./router/ApiRouter";


const config = loadConfig('Prod')

export class ApiServer {
    cfx: Conflux;
    config: StatConfig

    constructor() {
        this.config = config
        this.cfx = new Conflux(config.conflux)
    }

    public async init() {
        patchHttpProvider(this.cfx, config.conflux)
        // @ts-ignore
        await this.cfx.updateNetworkId();
        const cfxStatus:any = await this.cfx.getStatus()
        StatApp.networkId = cfxStatus.networkId
        StatApp.readonly = config.database.readonly
        createDB(config.database)
        await RedisWrap.connect(config.redis)
    }
}

export function initApiServer() {
    const apiServer = new ApiServer();
    apiServer.init().then(()=>{
        return register(app, apiServer)
    }).then(()=>{
        const port = apiServer.config.apiPort || 9527;
        app.listen(port)
        console.log(`api server listen at ${port}`)
    })
}

if (module === require.main) {
    initApiServer()
}