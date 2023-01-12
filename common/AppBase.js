// eslint-disable-next-line no-extend-native
BigInt.prototype.toJSON = function () {
  return this.toString();
};

const lodash = require('lodash');
const Koaflow = require('koaflow');
const requestLogger = require('koaflow/lib/middleware/requestLogger');
const requestId = require('koaflow/lib/middleware/requestId');

const { Conflux } = require('js-conflux-sdk');
const WSServer = require('./lib/WSServer');
const TTLMap = require('./lib/TTLMap');
const DingTalkRobot = require('./lib/DingTalkRobot');

const CONST = require('./const');
const error = require('./error');
const tool = require('./tool');
const type = require('./type');
const Prometheus = require('./Prometheus');
const TraceLog = require('./TraceLog');
const ConfluxSDK = require('./ConfluxSDK');
const {createLogger} = require("./utils");


class AppBase extends Koaflow {
  constructor(config) {
    super();

    this.config = type.config(config);
    this.CONST = CONST;
    this.error = error;
    this.tool = tool;
    this.type = type;

    this.webSocket = new WSServer({ noServer: true });
    this.ttlMap = new TTLMap();
    // this.logger = new Logger(config.logger);
    let logger = createLogger('scan', 'scan-api', './log/scan-api', 'info');
    this.logger = logger;
    // this.cfxSDK = new Conflux(config.conflux);
    console.log(`rpc config `, config.conflux)
    this.confluxSDK = new ConfluxSDK(config.conflux);
    this.cfxSDK = this.confluxSDK;
    this.dingTalk = new DingTalkRobot(lodash.defaults(config.dingTalk, {
      machine: config.machine,
      service: process.env.SERVICE,
    }));

    // traceLog
    this.traceLog = new TraceLog(this.logger);
    this.traceLog.traceModule(this, { level: 'info' });
    this.traceLog.traceModule(this.confluxSDK, { level: 'debug' });
    this.traceLog.traceMethod(this.confluxSDK.provider, 'call', {
      level: 'debug',
      params: (...args) => args,
      error: (e) => e.message,
    });

    // prometheus
    this.prometheus = new Prometheus({
      machine: config.machine,
      service: process.env.SERVICE,
    });
    this.prometheus.traceMethod(this.confluxSDK.provider, 'call', (method) => ({ module: 'conflux', method }));
    this.prometheus.traceModule(this.confluxSDK);
  }

  listen(port) {
    this.use(requestLogger(this.logger, this.config.requestLogger));
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

  async clear() {
    this.ttlMap.clear(); // clear cache
  }

  async close() {
    await this.confluxSDK.close();
    await this.webSocket.close();
    this.ttlMap.close();
    await super.close();
  }
}

module.exports = AppBase;
