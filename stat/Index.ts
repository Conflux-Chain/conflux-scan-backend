import {StatApp} from "./StatApp";
import {loadConfig} from "./config/StatConfig";
import {register} from "./router/StatRouter";
import {KV} from "./model/KV";
import {redisWrap} from "./service/RedisWrap";
import {Server} from 'http'

const Koa = require('koa');
const app = new Koa();
const serve = require('koa-static');
// __dirname is conflux-scan-statistics/stat/dist
const public_dir = __dirname + '/../../public'; // prefix 'stat' is configured through nginx and koa router.
app.use(serve(public_dir, {maxage: 1000*10})); // maxage in ms.
const path = require('path')
// app.use(serve('.'));

export async function init() {
// logger
    app.use(async (ctx, next) => {
        await next();
        const rt = ctx.response.get('X-Response-Time');
        console.log(`request logger: ${ctx.method} ${ctx.url} - ${rt}`);
    });

// x-response-time
    app.use(async (ctx, next) => {
        const start = Date.now();
        await next();
        const ms = Date.now() - start;
        ctx.set('X-Response-Time', `${ms}ms`);
    });

    console.log(`${new Date().toISOString()}=======start stat app=======`)
    console.log(`serve static file at ${path.resolve(public_dir)}`)

    const config = loadConfig('Prod')
    const statApp = new StatApp(config);
    await statApp.init();
    register(app, statApp)
    const server = app.listen(config.port || 8087);
    regProcessHook(server)
}

function exitOnSignal(server: Server) {
    return async (signal) => {
        console.log(`receive ${signal}`)
        // stop service
        await server.close()
        // close db first, make sure that unfinished message will not be deleted from redis.
        // When handling redis message, we call XDEL after all operation is finished.
        await KV.sequelize.close()
        // close redis.
        await redisWrap.client.end(false)
        console.log(`server shutdown.`)
        process.exit(0)
    }
}

function regProcessHook(server: Server) {
    process.on('SIGINT', exitOnSignal(server));
    process.on('SIGTERM', exitOnSignal(server));
}
init().then()