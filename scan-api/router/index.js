const Koaflow = require('koaflow');
const jsonrpc = require('./jsonrpc');

const router = new Koaflow.Router();

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

router.post('/',
  (ctx) => ctx.request.body,
  jsonrpc,
);

router.sub('/supply', require('./supply'));
router.sub('/v1', require('./v1'));

module.exports = router;
