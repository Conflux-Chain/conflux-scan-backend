const JsonRPCFlow = require('koaflow/lib/flow/JsonRPCFlow');
const {Errors} = require("../../stat/dist/service/common/LogicError");

/**
 * lib/OpenAPI/Flow.js contains bugs, it will swallow the error near line 135.
 */
class MyJsonRpcFlow extends JsonRPCFlow {
  methodFlow(method) {
    const jsonRPCFlow = this;

    return async function (arg, next, end) {
      // console.log(`enter ${__filename} `);
      try {
        const flow = jsonRPCFlow.methods[method]; // dynamic get method
        const ret = await flow.call(this, [arg], next, end);
        // console.log(`leave ${__filename}`);
        return ret;
      } catch (e) {
        this.methodFlowError = e;
        console.log(`error caught at ${__filename} \n `, e);
        end(/* nothing but stop calling chain */);
      }
    };
  }
}
function transformError(ctx, e, msg = '', detail = '') {
  // some error may have a string code.
  let isNumber = typeof(e.code) === 'number';
  ctx.body = { code: isNumber ? e.code : 500, message: (e.name || '')+msg + ' ' + detail + (isNumber ? '' : e.code) };
  ctx.status = 600;
}
function patchFlowError(ctx) {
  if (ctx.body) {
    // console.log(`body is present, and methodFlowError is `, ctx.methodFlowError);
  } else if (ctx.methodFlowError) {
    const { code, method: _method, url = '', message = '' } = ctx.methodFlowError;
    if (code === 'ABORTED' && _method === 'POST' && url.startsWith('http://172.31')) {
      transformError(ctx, new Errors.RpcBusyError(), url.substring('http://172.31.'.length), code);
    } else if (message.startsWith('Invalid params: expected a numbers with less than largest epoch number')) {
      transformError(ctx, new Errors.RpcBizError(), ' ', message);
    } else {
      transformError(ctx, ctx.methodFlowError, message);
    }
  }
}

module.exports = MyJsonRpcFlow;
module.exports.patchFlowError = patchFlowError;
