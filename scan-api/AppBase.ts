import {TokenTool} from "../stat/service/tool/TokenTool";
import {initCfxSdk, initEthSdk} from "../stat/service/common/utils";
import {setCfxRpcUrl} from "../koaflow/lib/flow/JsonRPCFlow";
import {StatConfig} from "../stat/config/StatConfig";

const koaBodyParser = require('koa-bodyparser');
const {requestLogger} = require('../koaflow/lib/middleware/requestLogger');
const TTLMap = require('../common/lib/TTLMap');
const error = require('../common/error');
const tool = require('../common/tool');
const type = require('../common/type');
const TraceLog = require('../common/TraceLog');
const {createLogger} = require("../common/utils");
const Koa = require('koa');

// eslint-disable-next-line no-extend-native
// @ts-ignore
BigInt.prototype.toJSON = function () {
  return this.toString();
};

export class AppBase extends Koa {
  public config: StatConfig;

  constructor(config) {
    super();
    this.config = config;
    this.use(koaBodyParser({ enableTypes: ['json', 'form', 'text'] }));
  }

  async init() {
    const {config} = this;

    this.error = error;
    this.tool = tool;
    this.type = type;

    this.ttlMap = new TTLMap();
    this.logger = createLogger('scan', 'api', `${process.cwd()}/log`, 'info', true);
    this.cfx = await initCfxSdk(config.conflux, 'common-conflux-sdk');
    this.eth = initEthSdk(config.ether?.url);
    setCfxRpcUrl(config.conflux.url);
    this.tokenTool = new TokenTool(this.cfx);

    this.traceLog = new TraceLog();
    this.traceLog.traceModule(this, { level: 'info' });
  }

  listen(port) {
    const {config: {requestLogger: reqLoggerCfg}} = this;

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

