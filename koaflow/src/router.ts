const lodash = require('lodash');
const KoaRouter = require('koa-router');
const { composeFlow } = require('./util');

/**
 * Router
 */
export class Router extends KoaRouter {
  constructor(...args) {
    super(...args);
    this.pathTable = {};

    // methods name from "this.methods", list them for IDEA friendly
    this.all = this._asFlow('all');
    this.head = this._asFlow('head');
    this.options = this._asFlow('options');
    this.get = this._asFlow('get');
    this.put = this._asFlow('put');
    this.patch = this._asFlow('patch');
    this.post = this._asFlow('post');
    this.delete = this._asFlow('delete');
  }

  _asFlow(methodName) {
    const method = this[methodName];
    this[`_original_${methodName}`] = method;

    return function (path, ...flowArray) {
      lodash.set(this.pathTable, [path, methodName], flowArray);

      const flow = composeFlow(flowArray);
      const middleware = async (ctx) => {
        const ret = await flow.call(ctx, ctx);
        if (ret !== undefined) {
          ctx.body = ret;
        }
      };

      method.call(this, path, middleware);
    };
  }

  sub(path, router) {
    if (!(typeof path === 'string')) {
      throw new Error(`path "${path}" not string`);
    }
    if (!(router instanceof KoaRouter)) {
      throw new Error(`${router} not instanceof koa-router`);
    }

    lodash.set(this.pathTable, [path, 'sub'], router);
    this.use(path, router.routes(), router.allowedMethods());
  }
}

// module.exports = Router;
