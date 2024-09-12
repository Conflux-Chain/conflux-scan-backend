import {TokenTool} from "../stat/service/tool/TokenTool";
import {initCfxSdk} from "../stat/service/common/utils";

const lodash = require('lodash');
const koaBodyParser = require('koa-bodyparser');
const {requestLogger} = require('../koaflow/lib/middleware/requestLogger');
const {requestId} = require('../koaflow/lib/middleware/requestId');
const TTLMap = require('../common/lib/TTLMap');
const DingTalkRobot = require('../common/lib/DingTalkRobot');
const CONST = require('../common/const');
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
  constructor(config) {
    super();
    this.use(koaBodyParser({ enableTypes: ['json', 'form', 'text'] }));
    this.config = type.config(config);
  }

  async init() {
    const {config} = this;
    this.CONST = CONST;
    this.error = error;
    this.tool = tool;
    this.type = type;

    this.ttlMap = new TTLMap();
    // console.log(`cwd`, process.cwd()) // it's '/'
    // In docker container, '/log' is bind to ./log/<api|compiler>
    this.logger = createLogger('scan', config.SERVICE, `${process.cwd()}/log`, 'info', true);
    if (config.conflux) {
      // compiler app doesn't need it
      this.cfx = await initCfxSdk(config.conflux, 'common-conflux-sdk');
      this.tokenTool = new TokenTool(this.cfx);
    }
    this.dingTalk = new DingTalkRobot(lodash.defaults(config.dingTalk, {
      machine: config.machine,
      service: process.env.SERVICE,
    }));

    // traceLog
    this.traceLog = new TraceLog(this.logger);
    this.traceLog.traceModule(this, { level: 'info' });
  }

  listen(port) {
    const {config: {requestLogger: reqLogConf}} = this;
    const reqLogger = requestLogger(this.logger, this.config.requestLogger);
    this.use(async function (ctx, next) {
      // use curl localhost:8895/switch-req-log to control it.
      if (reqLogConf.enable ?? true) {
        return reqLogger(ctx, next);
      }
      return next();
    });
    this.use(requestId);

    if (!this.server) {
      this.use(this.router.routes());
      this.use(this.router.allowedMethods());
      this.server = super.listen(port || this.config.port);
    }
  }

  async run() {
    while (tool.isRunning()) {
      await tool.sleep(1000);
    }
  }

  async close() {
    await this.cfx.close();
    this.ttlMap.close();

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

