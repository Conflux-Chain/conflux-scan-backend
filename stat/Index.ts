import {StatApp} from "./StatApp";
import {loadConfig} from "./config/StatConfig";
import {register} from "./router/StatRouter";

const Koa = require('koa');
const app = new Koa();
const serve = require('koa-static');
// __dirname is conflux-scan-statistics/stat/dist
const public_dir = __dirname + '/../../public'; // prefix 'stat' is configured through nginx and koa router.
app.use(serve(public_dir, {maxage: 1000*60*60})); // maxage in ms.
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
    app.listen(config.port || 8087);
}

init().then()