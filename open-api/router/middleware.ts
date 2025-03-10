import * as Koa from "koa";
import {koaSwagger} from "koa2-swagger-ui";
import {getApiService} from "../ApiServer";
import {InvalidParamError} from "../../stat/service/common/utils";
import {StatApp} from "../../stat/StatApp";
import {saveApiLog} from "../../stat/monitor/ApiLog";
import {KnownError} from "../common/RestTool";
import {CODE_PARAMETER_ERROR, CODE_PARAMETER_ERROR_MSG, CODE_RATE_LIMITED} from "../common/Def";
import {getClientIP} from "../../stat/router/RateLimiter";
import {safeAddErrorLog} from "../../stat/monitor/ErrorMonitor";

const yamljs = require('yamljs');
const swStats = require('swagger-stats');
const e2k = require('express-to-koa');
const Limiter = require('ratelimiter')
const swsProcessor = require('swagger-stats/lib/swsProcessor.js');

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
        let elapsed = Date.now() - start
        ctx.set('execution-time', elapsed)
        saveApiLog(ctx, elapsed).catch()
        const externalMs = ctx.response.get('external-ms') || 0
        elapsed -= externalMs
        getApiService().metrics.metric({ctx, elapsed}).then().catch(e => console.log(`metrics error:`, e))
    });
}
export async function rateControl(ctx, next) {
    // https://www.npmjs.com/package/ratelimiter
    const ip = getClientIP(ctx);
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
        if (err?.message?.includes('path="", not match "hex40"')) {
            setBody(ctx, ctx.request.query, CODE_PARAMETER_ERROR, CODE_PARAMETER_ERROR_MSG)
            return
        }
        if (err instanceof InvalidParamError) {
            setBody(ctx, ctx.request.query, CODE_PARAMETER_ERROR, err.message)
            return
        }
        if (/many requests/.test(err.message)){
            setBody(ctx, undefined, CODE_RATE_LIMITED, err.toString())
            return
        }
        setBody(ctx, undefined, 500, err.toString())
        if (err.code == 500) {
            safeAddErrorLog('open', `open-500-${err.message}`, err);
        }
        getApiService().logger.error(`api error ${ctx.request.url}`, err)
    })
}
export function setBody(ctx, data: any, code = 0, message = 'OK') {
    if(StatApp.isEVM){
        const status = code === 0 ? '1' : '0';
        ctx.body = {status, message, result: data};
        return;
    }

    ctx.body = {code, message, data};
}
function patchStatsLib() {
    const sFn = swsProcessor.apiStats.countResponse;
    let skipCount = 0;
    swsProcessor.apiStats.countResponse = (res)=>{
        if (res.statusCode == 404) {
            // skip
            if (skipCount % 1000 == 0) {
                console.log(`skip doing stat for 404 url [${res._swsReq.sws.api_path}] . count ${skipCount} `);
            }
            skipCount ++;
        } else {
            sFn(res);
        }
    }
}
// https://swaggerstats.io/guide/conf.html#options
export function addSwagger(app: Koa, prefix, swaggerYaml, tld) {
    console.log(` loading swaggerYaml:${swaggerYaml}`)
    const spec = yamljs.load(swaggerYaml);
    spec.info.description = spec.info.description.replace(/__tld__/gi, tld)
    console.log(` loading swaggerYaml:${swaggerYaml} done`)
    // metrics
    patchStatsLib();
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
