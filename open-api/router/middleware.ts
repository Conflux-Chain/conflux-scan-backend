import {CODE_PARAMETER_ERROR, CODE_PARAMETER_ERROR_MSG, CODE_RATE_LIMITED} from "../common/Def";
import {KnownError} from "../common/RestTool";
import {getApiService} from "../ApiServer";
import * as Koa from "koa";
import * as Router from "koa-router";
import * as path from "path";
const yamljs = require('yamljs');
import {koaSwagger} from "koa2-swagger-ui";
import {InvalidParamError} from "../../stat/service/common/utils";
import {StatApp} from "../../stat/StatApp";
const swStats = require('swagger-stats');
const e2k = require('express-to-koa');

const requestIp = require('request-ip');
const Limiter = require('ratelimiter')
const lodash = require('lodash');
let db
export function setRateControlDB(db0) {
    db = db0;
}
function getDB() {
    return db;
}
export async function executionTime(ctx, next) {
    const start = Date.now()
    return next().finally(()=>{
        ctx.set('execution-time', Date.now() - start)
    })
}
export async function rateControl(ctx, next) {
    // https://www.npmjs.com/package/ratelimiter
    const ip = requestIp.getClientIp(ctx.request)
    // duration - of limit in milliseconds [3600000]
    const max = 100, duration = 10_000
    const limit = new Limiter({ id: ip, db: getDB(), max, duration });
    const res = ctx
    await new Promise(resolve => {
        limit.get(function(err, limit){
            if (err) {
                next(err).then(resolve);
                return
            }

            res.set('X-RateLimit-Limit', limit.total);
            res.set('X-RateLimit-Remaining', limit.remaining - 1);
            res.set('X-RateLimit-Duration', duration);

            // all good
            // debug('remaining %s/%s %s', limit.remaining - 1, limit.total, id);
            if (limit.remaining) {
                next().then(resolve);
                return;
            }

            // not good
            const delta = (limit.reset * 1000) - Date.now() | 0;
            // const after = limit.reset - (Date.now() / 1000) | 0;
            res.set('Retry-After-ms', delta);
            ctx.body = { code: CODE_RATE_LIMITED, message: `Rate limit exceeded, retry in ${delta}ms`, retryAfterMs: delta  };
            resolve(CODE_RATE_LIMITED)
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
        if (err instanceof InvalidParamError) {
            setBody(ctx, ctx.request.query, CODE_PARAMETER_ERROR, err.message)
            return
        }
        setBody(ctx, undefined, 500, err.toString())
        getApiService().logger.error(`api error ${ctx.request.url}`, err)
    })
}
export function setBody(ctx, data: any, code = 0, message = 'ok') {
    ctx.body = {code, message, data}
}
// https://swaggerstats.io/guide/conf.html#options
export function addSwagger(app: Koa, prefix, swaggerYaml) {
    console.log(` loading swaggerYaml:${swaggerYaml}`)
    let spec = yamljs.load(swaggerYaml);
    console.log(` loading swaggerYaml:${swaggerYaml} done`)
    // metrics
    app.use(e2k(swStats.getMiddleware({
        uriPath: `${prefix}/swagger-stats`,
        hostname: 'OpenApi', // Prevent exposure of server ip
        basePath: prefix,
        swaggerSpec:spec,
    })));
    // swagger
    app.use(
        koaSwagger({
            routePrefix: `${prefix}/doc`,
            oauthOptions: {},
            swaggerOptions: {
                title: 'open-api-doc',
                spec
            },
        }),
    );
}