const Koaflow = require('koaflow');

const router = new Koaflow.Router();

router.get('/', () => ({
  project: 'scan-compiler',
  timestamp: Date.now(),
}));

router.post('/',
  (ctx) => ctx.request.body,
  require('./jsonrpc'),
);

module.exports = router;
