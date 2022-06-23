const lodash = require('lodash');
// const Knex = require('knex');
const { address, format } = require('js-conflux-sdk');
const { Sequelize } = require('sequelize');
// const KVStoreMap = require('../common/KVStoreMap');
const e2k = require('express-to-koa');
const swStats = require('swagger-stats');
const { RedisWrap, redisWrap } = require('../stat/dist/service/RedisWrap');
const { saveApiLog } = require("../stat/dist/monitor/ApiLog");
const { KV } = require('../stat/dist/model/KV');
const AppBase = require('../common/AppBase');
const JsonRPCSDK = require('../common/JsonRPCSDK');
const countRequestByIp = require('../common/middleware/countRequestByIp');
// const modelLoader = require('./model');
const serviceLoader = require('./service');
const router = require('./router');
const jsonrpc = require('./router/jsonrpc');
const { StatApp } = require('../stat/dist/StatApp');
const {setupEnsChecker} = require("../stat/dist/service/ens/EnsService");
const { checkRate, loadRateConfig } = require("../stat/dist/router/RateLimiter");
const { initPartialModel } = require('../stat/dist/service/DBProvider');
const apiSpec = require('../document/api-place-hoder-for-swagger-stat.json');

class ApiApp extends AppBase {
  // eslint-disable-next-line no-useless-constructor
  constructor(config) {
    super(config);
    // integrate with stat service
    // this.sequelize = createDB(config.database);
    // this.sequelize = new Sequelize(config.databaseRW.instanceName, null, null, config.databaseRW);
    // this.type.checksumAddress = this.type((v) => this.confluxSDK.ChecksumAddress(v))
    //     .$validate((v) => v.toObject().netName === this.confluxSDK.netName, `net must be "${this.confluxSDK.netName}"`)
    //     .$validate((v) => v.isValid(), 'isValid');
    // this.type.address = (this.type.checksumAddress.$after((v) => v.toHex())).$or(this.type.hex40);
    // this.type.simpleAddress = this.type.checksumAddress.$after((v) => v.toSimple());

    // this.kvStore = new KVStoreMap(config.kvStore);
    // this.knex = new Knex(config.knex);
    // this.syncSDK = new JsonRPCSDK(config.sync);
    // this.model = modelLoader(this);
    // this.service = serviceLoader(this);
    // this.router = router;

    // traceLog
    // this.traceLog.traceMethod(this.syncSDK, 'call', {
    //   module: 'syncSDK',
    //   level: 'debug',
    //   params: (...args) => args,
    //   error: (e) => e.message,
    // });
    // lodash.forEach(jsonrpc.methods, (func, method) => {
    //   this.traceLog.traceMethod(jsonrpc.methods, method, {
    //     module: 'JsonRPC',
    //     level: 'debug',
    //     params: (params) => lodash.first(params),
    //     error: (e) => e.message,
    //   });
    // });
    // lodash.forEach(this.service, (object) => {
    //   this.traceLog.traceModule(object, { level: 'debug' });
    // });
    // lodash.forEach(this.model, (object) => {
    //   this.traceLog.traceModule(object, { level: 'debug' });
    // });

    // prometheus
    // this.prometheus.traceModule(this.service.conflux);
    // this.prometheus.traceMethod(this.syncSDK, 'call', (method) => ({ module: 'SyncSDK', method }));
    // lodash.forEach(jsonrpc.methods, (func, method) => {
    //   this.prometheus.traceMethod(jsonrpc.methods, method, () => ({ module: 'JsonRPC', method }));
    // });
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
          console.log(` json rpc error: ${method}`, e);
          return e.message;
        },
      });
    });
    lodash.forEach(this.service, (object) => {
      this.traceLog.traceModule(object, { level: 'debug' });
    });
  }

  startPrometheus() {
    this.prometheus.traceModule(this.service.conflux);
    this.prometheus.traceMethod(this.syncSDK, 'call', (method) => ({ module: 'SyncSDK', method }));
    lodash.forEach(jsonrpc.methods, (func, method) => {
      this.prometheus.traceMethod(jsonrpc.methods, method, () => ({ module: 'JsonRPC', method }));
    });
  }

  // async createTable() {
  //   await Promise.all(lodash.map(this.model, (model) => model.createTable()));
  // }

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
    // console.log(` path def is `, pathDef, this.router.stack[5]);
    // console.log(`routers :`, paths);
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
    // websocket json rpc
    this.webSocket.on('message', async (client, message) => {
      const input = JSON.parse(message);
      const output = await jsonrpc.call({ app: this, request: client.request }, input);
      await client.send(JSON.stringify(output));
    });
    console.log(` scan api listen on port ${port || this.config.port}`);
    return super.listen(port);
  }

  async run() {
    const { config, confluxSDK } = this;
    const cfxStatus = await confluxSDK.getStatus();
    console.log(`================= start api , networkId ${cfxStatus.networkId} =============`);

    // networkId
    await confluxSDK.updateNetworkId();
    this.networkId = cfxStatus.chainId;

    // db
    this.sequelize = new Sequelize(config.databaseRW.instanceName, null, null, config.databaseRW);
    await RedisWrap.connect(config.redis);
    // await this.createTable();

    // type converter
    this.type.checksumAddress = this.type((v) => format.address(v, this.networkId, true));
    this.type.address = (this.type.checksumAddress.$after((v) => format.hexAddress(v))).$or(this.type.hex40);
    this.type.simpleAddress = this.type.checksumAddress.$after((v) => address.simplifyCfxAddress(v));
    this.router = router;

    // backend service
    this.syncSDK = new JsonRPCSDK(config.sync);
    this.service = serviceLoader(this);
    this.startLog();
    this.startPrometheus();

    // stat service
    StatApp.readonly = this.config.database.readonly;
    StatApp.networkId = this.networkId;
    await initPartialModel(this.sequelize);
    if (this.config.database.syncSchema) {
      await this.sequelize.sync({ alter: false });
    } else {
      console.log(`${new Date().toISOString()} ScanApi skip sync schema`);
    }
    await setupEnsChecker(this.confluxSDK)
    await this.service.homeDashboard.schedule().catch(() => undefined);
    if (this.config.blacklist) {
      await this.service.desensitizer.scheduleRefreshBlacklist();
    }

    // start listen
    this.listen();
    await super.run();
    console.log(' api runs over.');
  }

  async clear() {
    // await Promise.all(lodash.map(this.model, (model) => model.clear()));
    // await this.kvStore.clear();
    return super.clear();
  }

  async close() {
    // await this.kvStore.close();
    // await this.knex.destroy(); // although named 'destroy' but just close, not clear db
    await this.syncSDK.close();
    await KV.sequelize.close();
    await redisWrap.client.end(false);
    console.log('___ close scan api. ___');
    return super.close().then(() => { process.exit(0); });
  }
}

module.exports = ApiApp;
