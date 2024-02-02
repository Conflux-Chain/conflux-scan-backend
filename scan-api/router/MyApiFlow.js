const {Flow} = require("../../koaflow/lib/OpenAPI/Flow");
class MyApiFlow extends Flow {
    async call(ctx, arg, next, end) {
        let body;

        try {
            body = await next(this.input(arg));

            ctx.body = body; // to got ctx.status
            const picker = this.output[ctx.status] || (v => v);
            // consider removing the picker (ie: exposing all fields)
            body = picker(body);
        } catch (e) {
            ctx.methodFlowError = e;
            console.log(`${__filename} catches unknown error \n url: ${ctx.originalUrl} \n`, e)
            // ctx.status = e.status || 500;
            // const picker = this.output[ctx.status] || (() =>e.message);
            // body = picker(e);

            end();
        }

        return body;
    }
}
function myFlow(...args) {
    return new MyApiFlow(...args);
}

module.exports = myFlow;
