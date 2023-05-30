const lodash = require('lodash');
const Koaflow = require('koaflow');
const requestLogger = require('koaflow/lib/middleware/requestLogger');
const requestId = require('koaflow/lib/middleware/requestId');
const WSServer = require('./lib/WSServer');
const TTLMap = require('./lib/TTLMap');
const DingTalkRobot = require('./lib/DingTalkRobot');
const CONST = require('./const');
const error = require('./error');
const tool = require('./tool');
const type = require('./type');
const Prometheus = require('./Prometheus');
const TraceLog = require('./TraceLog');
const {createLogger} = require("./utils");
const {TokenTool} = require("../stat/dist/service/tool/TokenTool");
const {initCfxSdk} = require("../stat/dist/service/common/utils");

// eslint-disable-next-line no-extend-native
BigInt.prototype.toJSON = function () {
  return this.toString();
};

class AppBase extends Koaflow {
  constructor(config) {
    super();
    this.config = type.config(config);
  }

  async init() {
    const {config} = this;
    this.CONST = CONST;
    this.error = error;
    this.tool = tool;
    this.type = type;

    this.webSocket = new WSServer({ noServer: true });
    this.ttlMap = new TTLMap();
    // console.log(`cwd`, process.cwd()) // it's '/'
    // In docker container, '/log' is bind to ./log/<api|compiler>
    this.logger = createLogger('scan', config.SERVICE, `${process.cwd()}/log`, 'info', true);
    this.cfx = await initCfxSdk(config.conflux, 'common-conflux-sdk');
    this.tokenTool = new TokenTool(this.cfx);
    this.dingTalk = new DingTalkRobot(lodash.defaults(config.dingTalk, {
      machine: config.machine,
      service: process.env.SERVICE,
    }));

    // traceLog
    this.traceLog = new TraceLog(this.logger);
    this.traceLog.traceModule(this, { level: 'info' });
    this.traceLog.traceModule(this.cfx, { level: 'debug' });
    this.traceLog.traceMethod(this.cfx.provider, 'call', {
      level: 'debug',
      params: (...args) => args,
      error: (e) => e.message,
    });

    // prometheus
    this.prometheus = new Prometheus({
      machine: config.machine,
      service: process.env.SERVICE,
    });
    this.prometheus.traceMethod(this.cfx.provider, 'call', (method) => ({ module: 'conflux', method }));
    this.prometheus.traceModule(this.cfx);
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

    const server = super.listen(port || this.config.port);
    server.on('upgrade', (...args) => this.webSocket.handleUpgrade(...args));
    return server;
  }

  async run() {
    while (tool.isRunning()) {
      await tool.sleep(1000);
    }
  }

  async close() {
    await this.cfx.close();
    await this.webSocket.close();
    this.ttlMap.close();
    await super.close();
  }
}

module.exports = AppBase;
