const {Router} = require('../../koaflow/src/router');

const router = new Router();

router.get('/', () => ({
  project: 'scan-compiler',
  timestamp: Date.now(),
}));

router.post('/',
  (ctx) => ctx.request.body,
  require('./jsonrpc'),
);

module.exports = router;
