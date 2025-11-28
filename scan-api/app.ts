import {router} from "./router";
import {ScanServices, serviceLoader} from "./service";
import {fmtAddr, StatApp} from "../stat/StatApp";
import {AppBase} from "./AppBase";
const lodash = require('lodash');
import { Sequelize } from 'sequelize';
import {checkRate, loadRateConfig} from "../stat/router/RateLimiter";
import {setSwStatFn} from "../stat/router/StatRouter";
import {initPartialModel} from "../stat/service/DBProvider";
import ApiDef from "../stat/router/ApiDef";
import {jsonrpc} from "./router/jsonrpc";
import {saveApiLog} from "../stat/monitor/ApiLog";
import {EVM_RPC_URL, IS_EVM2, KEY_EVM_VERSIONS, KV} from "../stat/model/KV";
import {setCfxRpcUrl} from "../koaflow/lib/flow/JsonRPCFlow";
import {CONST, CONST as CONST_TS} from "../stat/service/common/constant";
import {format} from "js-conflux-sdk";

const e2k = require('express-to-koa');
const swStats = require('swagger-stats');
const {parameterErrorCode} = require('../common/error')
const apiSpec = require('../document/api-place-hoder-for-swagger-stat.json');

export class ApiApp extends AppBase {
  service: ScanServices;
  static injectedSequelize: Sequelize;
  public networkId: number;
  static injectContext(seq: Sequelize) {
    this.injectedSequelize = seq;
  }
  constructor(config) {
    super(config);
  }

  async init() {
    await super.init();
    this.proxy = true;
    // networkId
    this.networkId = this.cfx.networkId;
    console.log(`================== start api, networkId ${this.cfx.networkId} ==================`);

    // db
    const {config} = this;
    config[EVM_RPC_URL] = (CONST.CHAIN_INFO[StatApp.networkId] || {})[EVM_RPC_URL];
    setCfxRpcUrl(config.conflux.url);
    this.sequelize = ApiApp.injectedSequelize || new Sequelize(config.databaseRW.instanceName, null, null, config.databaseRW);

    // type converter
    this.type.checksumAddress = this.type((v) => format.address(v, this.networkId, true));
    this.type.address = (this.type.checksumAddress.$after((v) => format.hexAddress(v))).$or(this.type.hex40);
    this.type.simpleAddress = this.type((v) => fmtAddr(v, StatApp.networkId));
    this.router = router;

    this.service = serviceLoader(this);
    this.startLog();

    // stat service
    StatApp.readonly = config.database?.readonly;
    StatApp.networkId = this.networkId;
    if (!ApiApp.injectedSequelize) {
      await initPartialModel(this.sequelize);
      if (config.database?.syncSchema) {
        await this.sequelize.sync({alter: false});
      } else {
        console.log(`${new Date().toISOString()} ScanApi skip sync schema`);
      }
    }

    // check config
    const value = await KV.getString(KEY_EVM_VERSIONS, undefined)
    if(!value) {
      const defaultVersions = CONST_TS.EVM_VERSION.join(',')
      await KV.create({key: KEY_EVM_VERSIONS, value: defaultVersions})
      console.log(`evm versions not set, use default`)
    }

    StatApp.isEVM = await KV.getSwitch(IS_EVM2);
    await this.service.homeDashboard.schedule().catch(() => undefined);
    if (config.blacklist) {
      await this.service.desensitizer.scheduleRefreshBlacklist();
    }
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

  listen(port = undefined) {
    const pathArr = this.router.stack.map((layer) => {
      return layer.path.split('/').map((sec) => {
        return sec.startsWith(':') ? `{${sec.substr(1)}}` : sec;
      }).join('/');
    });
    const pathDef = process.env['unified_mod'] ? ApiDef.paths : {};
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

    console.log(`================== /v1 api listen on port ${port || this.config.port} ==================`);
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
    await this.init();
    this.listen();
  }

  async close() {
    if (!ApiApp.injectedSequelize) {
      await KV.sequelize.close();
    }
    await super.close();
    console.log('================== close scan api ==================');
    process.exit(0);
  }
}
