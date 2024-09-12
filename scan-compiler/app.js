const lodash = require('lodash');
const AppBase = require('../scan-api/AppBase');
const FileMap = require('../common/lib/FileMap');
const Service = require('./service');
const router = require('./router');
const jsonrpc = require('./router/jsonrpc');

class App extends AppBase {
  constructor(config = {}) {
    super(config);
  }

  async init() {
    await super.init();

    // backend service
    const {config} = this;
    this.fileMap = new FileMap(config.fileMap);
    this.service = new Service(this);
    this.router = router;

    // traceLog
    lodash.forEach(jsonrpc.methods, (func, method) => {
      this.traceLog.traceMethod(jsonrpc.methods, method, {
        module: 'JsonRPC',
        level: 'info',
        params: (params) => lodash.first(params),
        error: (e) => e.message,
      });
    });
    this.traceLog.traceMethod(this.service, 'listVersion', { level: 'debug' });
    this.traceLog.traceMethod(this.service, 'loadVersion', { level: 'debug' });
    this.traceLog.traceMethod(this.service, 'compile', {
      level: 'debug',
      params: (options) => options.sourceCode.length,
    });
    this.traceLog.traceMethod(this.service, 'decompile', {
      level: 'debug',
      params: (options) => options.code.length,
    });
  }

  listen(port) {
    console.log(`================== scan compiler listen on port ${port || this.config.port} ==================`);
    return super.listen(port);
  }

  async start() {
    await this.init();
    this.listen();
    await super.run();
    console.log('compiler runs over.');
  }

  async close() {
    await super.close();
    console.log(`================== close scan compiler ==================`)
    process.exit(0);
  }
}

module.exports = App;
