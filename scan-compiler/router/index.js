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
    async (ctx) => {
        const req = ctx.request.body;
        ctx.body = await jsonrpcHandler.handle(ctx, req);
    },
);

module.exports = router;
