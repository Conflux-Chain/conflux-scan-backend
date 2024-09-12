const Koa = require('koa');
const koaBodyParser = require('koa-bodyparser');
const {Router} = require('./router');

/**
 * deprecated
 */
export class Koaflow extends Koa {
  constructor(options) {
    super(options);

    this.router = new Router();
    this.use(koaBodyParser({ enableTypes: ['json', 'form', 'text'] }));
  }

  use(func, { prepend = false } = {}) {
    super.use(func);
    if (prepend) {
      func = this.middleware.pop();
      this.middleware = [func, ...this.middleware];
    }
    return this;
  }

  listen(...args) {
    if (!this.server) {
      this.use(this.router.routes());
      this.use(this.router.allowedMethods());
      this.server = super.listen(...args);
    }
    return this.server;
  }

  close() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

// module.exports = Koaflow;
