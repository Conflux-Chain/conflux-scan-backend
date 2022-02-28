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

router.post('/',
  (ctx) => ctx.request.body,
  jsonrpc,
);

router.sub('/metrics', require('./metrics'));
router.sub('/supply', require('./supply'));
router.sub('/v1', require('./v1'));

module.exports = router;
