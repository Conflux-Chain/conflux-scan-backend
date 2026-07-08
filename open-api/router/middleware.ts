import * as Koa from "koa";
import {koaSwagger} from "koa2-swagger-ui";
import {getApiService} from "../ApiServer";
import {InvalidParamError} from "../../stat/service/common/utils";
import {StatApp} from "../../stat/StatApp";
import {saveApiLog} from "../../stat/monitor/ApiLog";
import {CODE_PARAMETER_ERROR, CODE_PARAMETER_ERROR_MSG, CODE_RATE_LIMITED} from "../common/Def";
import {safeAddErrorLog} from "../../stat/monitor/ErrorMonitor";
import {EtherOption} from "../../stat/config/StatConfig";
import {DAY} from "../../stat/service/common/constant";

const superagent = require('superagent');
const yamljs = require('yamljs');
const swStats = require('swagger-stats');
const e2k = require('express-to-koa');
const swsProcessor = require('swagger-stats/lib/swsProcessor.js');

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

export async function handleException(ctx, next) {
    await next().catch(err => {
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
        console.log(`api error ${ctx.request.url}`, err)
    })
}

export function setBody(ctx, data: any, code = 0, message = 'OK') {
    if (StatApp.isEVM) {
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
    console.log(`loading swaggerYaml:${swaggerYaml}`)
    const spec = yamljs.load(swaggerYaml);
    spec.info.description = spec.info.description.replace(/__tld__/gi, tld)
    console.log(`loading swaggerYaml:${swaggerYaml} done`)
    // metrics
    patchStatsLib();
    app.use(e2k(swStats.getMiddleware({
        uriPath: `${prefix}/swagger-stats`,
        hostname: 'OpenApi', // Prevent exposure of server ip
        basePath: prefix,
        swaggerSpec: spec,
    })));
    // swagger
    app.use(
        koaSwagger({
            routePrefix: `${prefix}/doc`,
            specPrefix: `${prefix}/spec`,
            exposeSpec: true,
            oauthOptions: {},
            swaggerOptions: {
                title: 'open-api-doc',
                spec
            },
        }),
    );
}

export async function checkConfura(config?: EtherOption) {
    if (!StatApp.isEVM) {
        return;
    }

    if (!config || !config.url || typeof config.url !== "string") {
        console.log("Failed to load config for confura rpc!");
        process.exit(9);
    }

    async function fetchExpireAt(config) {
        const requestBody = {
            jsonrpc: "2.0",
            method: "diagnostic_getRateLimitStatus",
            params: [],
            id: 1,
        };

        const response = await superagent
            .post(config.url)
            .set({
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            })
            .timeout(config.timeout || 3000)
            .send(JSON.stringify(requestBody));

        const expireAtStr = response?.body?.result?.info?.web3payInfo?.expireAt;
        if (!expireAtStr) {
            throw new Error("field expireAt not found in confura response");
        }

        const expireAt = new Date(expireAtStr);
        if (isNaN(expireAt.getTime())) {
            throw new Error("field expireAt is invalid date");
        }

        console.log(`Succeed to get confura key expireAt ${expireAt.toISOString()}`);
        return expireAt;
    }

    function checkExpiration(expireAt) {
        const preAlertDays = 7; // 7 days
        const alertTime = new Date(expireAt.getTime() - preAlertDays * DAY);

        if ((new Date()) <= alertTime) {
            return;
        }

        safeAddErrorLog(
            "openapi",
            "confura-key",
            new Error(`The confura key has entered the ${preAlertDays}-day pre-alert window, expireAt=${expireAt.toISOString()}`)
        ).then();
        console.log("Succeed to alert confura key expiration");
    }

    try {
        const expireAt = await fetchExpireAt(config);

        checkExpiration(expireAt);

        setInterval(() => {
            checkExpiration(expireAt)
        }, DAY);
    } catch (e) {
        safeAddErrorLog("openapi", "confura-key", e).then();
        console.log("Failed to get confura key expireAt", e);
    }
}
