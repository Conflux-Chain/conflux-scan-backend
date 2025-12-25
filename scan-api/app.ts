import {router} from "./router";
import {ScanServices, serviceLoader} from "./service";
import {fmtAddr, StatApp} from "../stat/StatApp";
import {AppBase} from "./AppBase";
import {checkRate, loadRateConfig} from "../stat/router/RateLimiter";
import {setSwStatFn} from "../stat/router/StatRouter";
import ApiDef from "../stat/router/ApiDef";
import {jsonrpc} from "./router/jsonrpc";
import {saveApiLog} from "../stat/monitor/ApiLog";
import {KV} from "../stat/model/KV";
import {format} from "js-conflux-sdk";
import {StatConfig} from "../stat/config/StatConfig";

const lodash = require('lodash');
const e2k = require('express-to-koa');
const swStats = require('swagger-stats');
const {parameterErrorCode} = require('../common/error')
const apiSpec = require('../document/api-place-hoder-for-swagger-stat.json');

export class ApiApp extends AppBase {
  service: ScanServices;

  constructor(config: StatConfig) {
    super(config);
  }

  async init() {
    await super.init();
    this.proxy = true;

    // db
    this.sequelize = KV.sequelize;

    // type converter
    this.type.checksumAddress = this.type((v) => format.address(v, StatApp.networkId, true));
    this.type.address = (this.type.checksumAddress.$after((v) => format.hexAddress(v))).$or(this.type.hex40);
    this.type.simpleAddress = this.type((v) => fmtAddr(v, StatApp.networkId));
    this.router = router;

    this.service = serviceLoader(this);
    this.startLog();
  }

  // wrap error as ParameterError
  parseParam(fn:()=>any) {
    try {
      return fn();
    } catch (e) {
      throw new this.error.ParameterError(e);
    }
  }
  formatAddrObj(obj: any, props: string[]) {
    props.forEach(p=>{
      const v = obj[p];
      v && (obj[p] = this.type.simpleAddress(v));
    })
  }
	formatAddrInArray(list: any[], props: string[]) {
    if (!list) {
      return
    }
    list.forEach(row=>{
      this.formatAddrObj(row, props);
    });
  }

  listen(port) {
    const pathArr = this.router.stack.map((layer) => {
      return layer.path.split('/').map((sec) => {
        return sec.startsWith(':') ? `{${sec.substr(1)}}` : sec;
      }).join('/');
    });
    const pathDef = ApiDef.paths;
    pathArr.forEach((p) => {
      pathDef[p] = { get: {} };
    });
    apiSpec.paths = pathDef;

    loadRateConfig().then()

    this.use(checkRate)

    // metrics
    const swStat = e2k(swStats.getMiddleware({
      swaggerSpec: apiSpec,
      uriPath: '/v1/api-stat', // ui at /v1/api-stat/
      hostname: 'scan-backend-api-stat', // Prevent exposure of server ip
      basePath: '',
    }));
    setSwStatFn(swStat)
    this.use(swStat);

    this.use(async (ctx,next)=>{
      const start = Date.now();
      await next();
      const ms = Date.now() - start;
      saveApiLog(ctx, ms).catch()
    })

    return super.listen(port);
  }

  startLog() {
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
    console.log(`${new Date().toISOString()}=======start scan api========`);
    await this.init();
    const port = this.config.v1port;
    this.listen(port);
    console.log(`${new Date().toISOString()}=======scan api listen on port ${port} network ${StatApp.networkId}========`);
  }

  async close() {
    await super.close();
    console.log(`${new Date().toISOString()}=======close scan api========`);
    process.exit(0);
  }
}
