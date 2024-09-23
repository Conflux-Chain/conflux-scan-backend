const KoaRouter = require("koa-router");

const router = new KoaRouter();

router.get('/', (ctx) => {
    ctx.body = {
        project: 'scan-compiler',
        timestamp: Date.now(),
    }
});

const jsonrpcHandler = require('./jsonrpc')

router.post('/',
    (ctx) => {
        const req = ctx.request.body;
        ctx.body = jsonrpcHandler.call(ctx, req);
    },
);

module.exports = router;
