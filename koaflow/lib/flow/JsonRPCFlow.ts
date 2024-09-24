import {Errors, UnhandledErrorCode} from "../../../stat/service/common/LogicError";

const lodash = require('lodash');
const { composeFlow } = require('../../src/util');

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
  method_(method: string, ...flowArray:Function[]) {
    this.method(method, ...flowArray)
    return this.methods[method];
  }
  /**
   * @param method {string}
   * @param flowArray {function}
   */
  method(method: string, ...flowArray: Function[]) {
    if (Reflect.has(this.methods, method)) {
      throw new Error(`already exist method "${method}"`);
    }
    // scan-compiler: ctx.body = await jsonrpcHandler.call(ctx, req); in router/index.js, see `call` below.
    this.methods[method] =  composeFlow(flowArray);
  }

  /**
   * @param ctx {object} - Koa context instance
   * @param data {object|object[]}
   * @param next {function}
   * @param end {function}
   * @return {Promise<object>}
   */
  async call(ctx, data, next, end) {
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

      try {
        const result = await flow.call(ctx, params, next, end);
        return { jsonrpc, id, result };
      } catch (e) {
        const error = new JsonRPCError({ code: e.code || -32000, message: e.message || 'Server error' });
        return { jsonrpc, id, error };
      }
    };
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
