import * as KoaRouter from "koa-router";
import {ConfigInstance} from "../../stat/config/StatConfig";

export const router = new KoaRouter();

router.get('/', function () {
  return {
    info: `scan-api at ${ConfigInstance.serverTag}`,
  };
});

router.get('/switch-req-log', function () {
  const {    app: { config: { requestLogger } },  } = this;
  requestLogger.enable = !requestLogger.enable;
  return {
    enable: requestLogger.enable
  }
})

router.use('/supply', require('./supply').routes());
router.use('/v1', require('./v1').routes());
