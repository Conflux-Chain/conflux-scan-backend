import {redirectLog} from "./service/tool/LoggerConfig";
import {StatApp} from "./StatApp";
import {loadConfig} from "./config/StatConfig";
import {register} from "./router/StatRouter";
import {KV} from "./model/KV";
import {Server} from 'http'
import {saveApiLog} from "./monitor/ApiLog";
import {KEY_STAT, repeatHeartBeat} from "./model/HeartBeat";

const Koa = require('koa');
const serve = require('koa-static');
const path = require('path')

const public_dir = __dirname + '/../public'; // prefix 'stat' is configured through nginx and koa router.
const app = new Koa();
app.use(serve(public_dir, {maxage: 1000*10})); // maxage in ms.

export async function init() {
    console.log(`${new Date().toISOString()}=======start scan stat=======`)
    console.log(`serve static file at ${path.resolve(public_dir)}`)

    redirectLog({mainPath:'stat'})
    app.use(async (ctx, next) => {
        const start = Date.now();
        await next();
        const ms = Date.now() - start;
        saveApiLog(ctx, ms).catch()
        ctx.set('X-Response-Time', `${ms}ms`);
    });

    const config = loadConfig('Prod');
    const statApp = new StatApp(config);
    await statApp.init();

    register(app, statApp);
    const port = config.port || 8087;
    const server = app.listen(port);

    regProcessHook(server)
    repeatHeartBeat(`${KEY_STAT}_${config.serverTag}`)

    console.log(`${new Date().toISOString()}=======scan stat listen on port ${port} network ${StatApp.networkId}=======`);
    return statApp;
}

function exitOnSignal(server: Server) {
    return async (signal) => {
        console.log(`${__filename} receive ${signal}`)
        // stop service
        server.close()
        await KV.sequelize.close()
        console.log(`${new Date().toISOString()}=======close scan stat=======`);
        process.exit(0)
    }
}

function regProcessHook(server: Server) {
    process.on('SIGINT', exitOnSignal(server));
    process.on('SIGTERM', exitOnSignal(server));
}

if (require.main === module) {
    init().then();
}
