const lodash = require('lodash');
const AppBase = require('../common/AppBase');
const FileMap = require('../common/lib/FileMap');
const Service = require('./service');
const router = require('./router');
const jsonrpc = require('./router/jsonrpc');

class App extends AppBase {
  constructor(config = {}) {
    super(config);

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
    // websocket json rpc
    this.webSocket.on('message', async (client, message) => {
      const input = JSON.parse(message);
      const output = await jsonrpc.call({ app: this }, input);
      await client.send(JSON.stringify(output));
    });

    return super.listen(port);
  }

  async close() {
    await super.close();
    console.log(`close scan compiler`)
    process.exit(0)
  }
}

module.exports = App;
