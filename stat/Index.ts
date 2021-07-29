const superagent = require('superagent');
console.log(`----------------------- hack it  -------------`)
function logSend(p, data) {
    console.log(`request rpc ${data.method}`)
    return p.originSend(data)
}
function keepAlivePost(url) {
    // console.log(`============================`)
    const p = superagent.originPost(url)
    p.originSend = p.send;
    p.send = (data)=>logSend(p, data);
    return p.set('Connection', 'Keep-Alive');
}
superagent.originPost = superagent.post;
superagent.post = keepAlivePost;
import {StatApp} from "./StatApp";
import {loadConfig} from "./config/StatConfig";
import {register} from "./router/StatRouter";
const Koa = require('koa');
const app = new Koa();

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
    const config = loadConfig('Prod')
    const statApp = new StatApp(config);
    await statApp.init();
    register(app, statApp)
    app.listen(config.port || 8087);
}

init().then()