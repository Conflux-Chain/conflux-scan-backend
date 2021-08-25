import {CODE_PARAMETER_ERROR, CODE_PARAMETER_ERROR_MSG, CODE_RATE_LIMITED} from "../common/Def";
import {KnownError} from "../common/RestTool";
import {getApiService} from "../ApiServer";
import * as Koa from "koa";
import * as Router from "koa-router";
import * as path from "path";
const yamljs = require('yamljs');
import {koaSwagger} from "koa2-swagger-ui";

const requestIp = require('request-ip');
const Limiter = require('ratelimiter')
let db
export function setRateControlDB(db0) {
    db = db0;
}
function getDB() {
    return db;
}
export async function rateControl(ctx, next) {
    const ip = requestIp.getClientIp(ctx.request)
    const limit = new Limiter({ id: ip, db: getDB() });
    const res = ctx
    await new Promise(resolve => {
        limit.get(function(err, limit){
            if (err) {
                next(err).then(resolve);
                return
            }

            res.set('X-RateLimit-Limit', limit.total);
            res.set('X-RateLimit-Remaining', limit.remaining - 1);
            res.set('X-RateLimit-Reset', limit.reset);

            // all good
            // debug('remaining %s/%s %s', limit.remaining - 1, limit.total, id);
            if (limit.remaining) {
                next().then(resolve);
                return;
            }

            // not good
            const delta = (limit.reset * 1000) - Date.now() | 0;
            const after = limit.reset - (Date.now() / 1000) | 0;
            res.set('Retry-After', after);
            ctx.body = { code: CODE_RATE_LIMITED, message: `Rate limit exceeded, retry in ${delta}`  };
        });
    })

}
export async function handleException(ctx, next) {
    await next().catch(err => {
        if (err instanceof KnownError) {
            return
        }
        if (err.message.includes('path="", not match "hex40"')) {
            setBody(ctx, ctx.request.query, CODE_PARAMETER_ERROR, CODE_PARAMETER_ERROR_MSG)
            return
        }
        setBody(ctx, undefined, 500, err.toString())
        console.log((typeof err))
        getApiService().logger.error(`api error ${ctx.request.url}`, err)
    })
}
export function setBody(ctx, data: any, code = 0, message = 'ok') {
    ctx.body = {code, message, data}
}
export function addSwagger(app: Koa, router: Router<any, {}>, prefix) {
    const docPath = `${prefix}/doc`
    // let apiDef = '/open-api.yaml';
    const pwd = path.resolve('.')
    console.log(`pwd is ${pwd}`)
    const spec = yamljs.load('./document/open-api.yaml');
    app.use(
        koaSwagger({
            routePrefix: docPath,
            oauthOptions: {},
            swaggerOptions: {
                // url: `${prefix}${apiDef}`,
                title: 'open-api-doc',
                spec
            },
        }),
    );
}