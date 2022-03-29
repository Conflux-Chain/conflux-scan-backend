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
export function addSwagger(app: Koa, prefix) {
    console.log(` loading open-api.yaml`)
    const spec = yamljs.load('./document/open-api.yaml');
    if (StatApp.isEVM) {
        Object.keys(spec.paths).forEach(path => {
            if (path.startsWith('/statistics')) {
                delete spec.paths[path];
            }
            spec.paths[path]?.get?.parameters?.forEach(parameterObj => {
                Object.keys(parameterObj).forEach(key => {
                    const paraDefinition = parameterObj[key];
                    if (paraDefinition.endsWith('minEpochNumberParam')) {
                        const evmParaDefinition = paraDefinition.replace('minEpochNumberParam', 'startBlockParam')
                        parameterObj[key] = evmParaDefinition;
                    }
                    if (paraDefinition.endsWith('maxEpochNumberParam')) {
                        const evmParaDefinition = paraDefinition.replace('maxEpochNumberParam', 'endBlockParam')
                        parameterObj[key] = evmParaDefinition;
                    }
                });
            });
        });
        Object.keys(spec.components.schemas).forEach(schema => {
            if (schema.endsWith('Stat')) {
                delete spec.components.schemas[schema];
            }
        });
        Object.keys(spec.components.parameters).forEach(parameter => {
            if (lodash.includes(['account', 'from', 'to', 'ownerParam'], parameter)) {
                spec.components.parameters[parameter].description = `Account address, it's like 0xe47d6387edacde17804c5f5d709b73a4943a762c`;
            }
            if (lodash.includes(['contractParam', 'contractParamMust'], parameter)) {
                spec.components.parameters[parameter].description = `Contract address, it's like 0x4f9e3186513224cf152016ccd86019e7b9a3c809`;
            }
        });
    }
    console.log(` loading open-api.yaml done`)
    // metrics
    app.use(e2k(swStats.getMiddleware({
        swaggerSpec:spec,
        uriPath: `${prefix}/swagger-stats`,
        hostname: 'OpenApi', // Prevent exposure of server ip
        basePath: prefix,
    })));
    const docPath = `${prefix}/doc`
    // let apiDef = '/open-api.yaml';
    const pwd = path.resolve('.')
    // console.log(`pwd is ${pwd}`)
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