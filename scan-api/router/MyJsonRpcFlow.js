const JsonRPCFlow = require('koaflow/lib/flow/JsonRPCFlow');
const {parameterErrorCode} = require('../../common/error')
const {Errors, UnhandledErrorCode} = require("../../stat/dist/service/common/LogicError");

/**
 * lib/OpenAPI/Flow.js contains bugs, it swallows the error near line 135.
 */
let cfxRpcUrl = ''
class MyJsonRpcFlow extends JsonRPCFlow {
  // parent function doesn't return a value, wrap that.
  method_(method, ...flowArray) {
    super.method(method, ...flowArray)
    return this.methods[method];
  }
  methodFlow(method) {
    const jsonRPCFlow = this;

    return async function (arg, next, end) {
      // console.log(`enter ${__filename} `);
      try {
        const flow = jsonRPCFlow.methods[method]; // dynamic get method
        return await flow.call(this, [arg], next, end);
      } catch (e) {
        this.methodFlowError = e;
        if (e.code !== parameterErrorCode) {
          console.log(`error caught at ${__filename} \n url: ${this.originalUrl} \n`, e);
        }
        end(/* nothing but stop calling chain */);
      }
    };
  }
}
function transformError(ctx, e, msg = '', detail = '') {
  // some error may have a string code.
  let isNumber = typeof(e.code) === 'number';
  ctx.body = { code: isNumber ? e.code : UnhandledErrorCode, message: (e.name)+': '+msg + ' ' + detail + (isNumber ? '' : e.code || '') };
  ctx.status = 600;
}
function patchFlowError(ctx) {
  if (ctx.body) {
    // console.log(`body is present, and methodFlowError is `, ctx.methodFlowError);
  } else if (ctx.methodFlowError) {
    const { code, method: _method, url = '', message = '' } = ctx.methodFlowError;
    if (code === 'ABORTED' && _method === 'POST' && url.startsWith(cfxRpcUrl)) {
      transformError(ctx, new Errors.RpcBusyError(), ' ', code);
    } else if (message.startsWith('Invalid params: expected a numbers with less than largest epoch number')) {
      transformError(ctx, new Errors.RpcBizError(), ' ', message);
    } else {
      transformError(ctx, ctx.methodFlowError, message, '');
    }
  }
}

function setCfxRpcUrl(url) {
  cfxRpcUrl = url || ''
}

module.exports = MyJsonRpcFlow;
module.exports.patchFlowError = patchFlowError;
module.exports.setCfxRpcUrl = setCfxRpcUrl;
