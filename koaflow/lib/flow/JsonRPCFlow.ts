import {Errors, UnhandledErrorCode} from "../../../stat/service/common/LogicError";

const lodash = require('lodash');
const { composeFlow } = require('../../src/util');
const {parameterErrorCode} = require('../../common/error')

const VERSION = '2.0';

export class JsonRPCError extends Error {
  constructor(arg) {
    super();
    Object.assign(this, arg);
    if (arg instanceof Error) {
      this.message = arg.message;
      this.stack = arg.stack; // 复制调用栈, (stack 不会被设为 Object.keys)
    }
  }
}
let cfxRpcUrl = ''
export class JsonRPCFlow {
  private methods: any;
  constructor() {
    this.methods = {};
  }
  method_(method, ...flowArray) {
    this.method(method, ...flowArray)
    return this.methods[method];
  }
  /**
   * @param method {string}
   * @param flowArray {function}
   */
  method(method, ...flowArray) {
    if (Reflect.has(this.methods, method)) {
      throw new Error(`already exist method "${method}"`);
    }
    this.methods[method] = composeFlow(flowArray);
  }

  methodFlow(method) {
    const jsonRPCFlow = this;

    return async function (arg, next, end) {
      try {
        const flow = jsonRPCFlow.methods[method]; // dynamic get method
        return await flow.call(this, [arg], next, end);
      } catch (e) {
        if (!end) { // v1.ts, directly call in code
          throw e;
        }
        this.methodFlowError = e;
        if (e.code !== parameterErrorCode) {
          console.log(`error caught at ${__filename} \n url: ${this.originalUrl} \n`, e);
        }
        end(/* nothing but stop calling chain */);
      }
    };
  }

  /**
   * @param ctx {object} - Koa context instance
   * @param data {object|object[]}
   * @param next {function}
   * @param end {function}
   * @return {Promise<object>}
   */
  call(ctx, data, next, end) {
    const func = this.bind(ctx);

    return Array.isArray(data)
      ? Promise.all(data.map(d => func(d, next, end)))
      : func(data, next, end);
  }

  bind(ctx) {
    return async (data, next, end) => {
      if (!lodash.isPlainObject(data)) {
        const error = new JsonRPCError({ code: -32700, message: `Parse error "${data}" not a plain object` });
        return { jsonrpc: VERSION, id: null, error };
      }

      const { jsonrpc, id, method, params = [] } = data;
      if (jsonrpc !== VERSION) {
        const error = new JsonRPCError({ code: -32600, message: `Invalid request jsonrpc "${jsonrpc}"` });
        return { jsonrpc: VERSION, id, error };
      }

      const flow = this.methods[method];
      if (!flow) {
        const error = new JsonRPCError({ code: -32601, message: `Method not found "${method}"` });
        return { jsonrpc, id, error };
      }

      if (!Array.isArray(params)) {
        const error = new JsonRPCError({ code: -32602, message: `Invalid params ${JSON.stringify(params)}` });
        return { jsonrpc, id, error };
      }

      // XXX: new JsonRPCError({ code: -32603, message: 'Internal error' });

      try {
        const result = await flow.call(ctx, params, next, end);
        return { jsonrpc, id, result };
      } catch (e) {
        const error = new JsonRPCError({ code: e.code || -32000, message: e.message || 'Server error' });
        return { jsonrpc, id, error };
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
export function patchFlowError(ctx) {
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

export function setCfxRpcUrl(url) {
  cfxRpcUrl = url || ''
}

// module.exports = JsonRPCFlow;
// module.exports.JsonRPCError = JsonRPCError;
