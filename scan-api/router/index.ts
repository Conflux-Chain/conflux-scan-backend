import * as KoaRouter from "koa-router";

export const router = new KoaRouter();

router.get('/', function () {
  const {
    app: { config: { machine } },
  } = this;

  return {
    info: `scan-api at ${machine}`,
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
