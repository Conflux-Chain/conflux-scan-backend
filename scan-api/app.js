const lodash = require('lodash');
const { address, format } = require('js-conflux-sdk');
const { Sequelize } = require('sequelize');
const e2k = require('express-to-koa');
const swStats = require('swagger-stats');

const AppBase = require('../common/AppBase');
const {parameterErrorCode} = require('../common/error')
const JsonRPCSDK = require('../common/JsonRPCSDK');
const countRequestByIp = require('../common/middleware/countRequestByIp');
const serviceLoader = require('./service');
const router = require('./router');
const jsonrpc = require('./router/jsonrpc');
const apiSpec = require('../document/api-place-hoder-for-swagger-stat.json');

const { StatApp } = require('../stat/dist/StatApp');
const { checkRate, loadRateConfig } = require("../stat/dist/router/RateLimiter");
const { initPartialModel } = require('../stat/dist/service/DBProvider');
const { RedisWrap, redisWrap } = require('../stat/dist/service/RedisWrap');
const { saveApiLog } = require("../stat/dist/monitor/ApiLog");
const { KV, IS_EVM2 } = require('../stat/dist/model/KV');
const {setCfxRpcUrl} = require("./router/MyJsonRpcFlow");

class ApiApp extends AppBase {
  static injectedSequelize;
  static injectContext(seq) {
    this.injectedSequelize = seq;
  }
  constructor(config) {
    super(config);
  }

  async init() {
    await super.init();

    // networkId
    this.networkId = this.cfx.networkId;
    console.log(`================== start api, networkId ${this.cfx.networkId} ==================`);

    // db
    const {config} = this;
    setCfxRpcUrl(config.conflux.url)
    this.sequelize = ApiApp.injectedSequelize || new Sequelize(config.databaseRW.instanceName, null, null, config.databaseRW);
    await RedisWrap.connect(config.redis);

    // type converter
    this.type.checksumAddress = this.type((v) => format.address(v, this.networkId, true));
    this.type.address = (this.type.checksumAddress.$after((v) => format.hexAddress(v))).$or(this.type.hex40);
    this.type.simpleAddress = this.type.checksumAddress.$after((v) => address.simplifyCfxAddress(v));
    this.router = router;

    // 2024.1.9, it only calls to compiler.
    this.syncSDK = new JsonRPCSDK(config.sync);
    this.service = serviceLoader(this);
    this.startLog();

    // stat service
    StatApp.readonly = config.database.readonly;
    StatApp.networkId = this.networkId;
    if (!ApiApp.injectedSequelize) {
      await initPartialModel(this.sequelize);
      if (config.database.syncSchema) {
        await this.sequelize.sync({alter: false});
      } else {
        console.log(`${new Date().toISOString()} ScanApi skip sync schema`);
      }
    }
    StatApp.isEVM = await KV.getSwitch(IS_EVM2);
    await this.service.homeDashboard.schedule().catch(() => undefined);
    if (config.blacklist) {
      await this.service.desensitizer.scheduleRefreshBlacklist();
    }
  }

  listen(port) {
    const pathArr = this.router.stack.map((layer) => {
      return layer.path.split('/').map((sec) => {
        return sec.startsWith(':') ? `{${sec.substr(1)}}` : sec;
      }).join('/');
    });
    const pathDef = {};
    pathArr.forEach((p) => {
      pathDef[p] = { get: {} };
    });
    apiSpec.paths = pathDef;

    this.use(countRequestByIp);
    loadRateConfig().then()

    this.use(checkRate)

    // metrics
    this.use(e2k(swStats.getMiddleware({
      swaggerSpec: apiSpec,
      uriPath: '/v1/api-stat', // ui at /v1/api-stat/
      hostname: 'scan-backend-api-stat', // Prevent exposure of server ip
      basePath: '',
    })));

    this.use(async (ctx,next)=>{
      const start = Date.now();
      await next();
      const ms = Date.now() - start;
      saveApiLog(ctx, ms).catch()
    })

    console.log(`================== scan api listen on port ${port || this.config.port} ==================`);
    return super.listen(port);
  }

  startLog() {
    this.traceLog.traceMethod(this.syncSDK, 'call', {
      module: 'syncSDK',
      level: 'debug',
      params: (...args) => args,
      error: (e) => e.message,
    });
    lodash.forEach(jsonrpc.methods, (func, method) => {
      this.traceLog.traceMethod(jsonrpc.methods, method, {
        module: 'JsonRPC',
        level: 'debug',
        params: (params) => lodash.first(params),
        error: (e) => {
          if (e.code !== parameterErrorCode) {
            console.log(` json rpc error: ${method}`, e);
          }
          return e.message;
        },
      });
    });
    lodash.forEach(this.service, (object) => {
      this.traceLog.traceModule(object, { level: 'debug' });
    });
  }

  async start() {
    await this.init();
    this.listen();
    await super.run();
    console.log('api runs over.');
  }

  async close() {
    await this.syncSDK.close();
    if (!ApiApp.injectedSequelize) {
      await KV.sequelize.close();
      redisWrap.client.end(false);
    }
    await super.close();
    console.log('================== close scan api ==================');
    process.exit(0);
  }
}

module.exports = ApiApp;
