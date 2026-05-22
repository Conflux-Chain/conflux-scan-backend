"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppBase = void 0;
const TokenTool_1 = require("../stat/service/tool/TokenTool");
const utils_1 = require("../stat/service/common/utils");
const JsonRPCFlow_1 = require("../koaflow/lib/flow/JsonRPCFlow");
const koaBodyParser = require('koa-bodyparser');
const { requestLogger } = require('../koaflow/lib/middleware/requestLogger');
const TTLMap = require('../common/lib/TTLMap');
const error = require('../common/error');
const tool = require('../common/tool');
const type = require('../common/type');
const TraceLog = require('../common/TraceLog');
const { createLogger } = require("../common/utils");
const Koa = require('koa');
// eslint-disable-next-line no-extend-native
// @ts-ignore
BigInt.prototype.toJSON = function () {
    return this.toString();
};
class AppBase extends Koa {
    constructor(config) {
        super();
        this.config = config;
        this.use(koaBodyParser({ enableTypes: ['json', 'form', 'text'] }));
    }
    async init() {
        const { config } = this;
        this.error = error;
        this.tool = tool;
        this.type = type;
        this.ttlMap = new TTLMap();
        this.logger = createLogger('scan', 'api', `${process.cwd()}/log`, 'info', true);
        this.cfx = await (0, utils_1.initCfxSdk)(config.conflux, 'common-conflux-sdk');
        (0, JsonRPCFlow_1.setCfxRpcUrl)(config.conflux.url);
        this.tokenTool = new TokenTool_1.TokenTool(this.cfx);
        this.traceLog = new TraceLog();
        this.traceLog.traceModule(this, { level: 'info' });
    }
    listen(port) {
        const { config: { requestLogger: reqLoggerCfg } } = this;
        const reqLogger = requestLogger(this.logger, reqLoggerCfg);
        this.use(async function (ctx, next) {
            // use curl localhost:8895/switch-req-log to control it.
            if (reqLoggerCfg.enable ?? true) {
                return reqLogger(ctx, next);
            }
            return next();
        });
        if (!this.server) {
            this.use(this.router.routes());
            this.use(this.router.allowedMethods());
            this.server = super.listen(port);
        }
    }
    async close() {
        await this.cfx?.close();
        this.ttlMap.close();
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
exports.AppBase = AppBase;
