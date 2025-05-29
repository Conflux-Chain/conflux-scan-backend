const {loadConfig} = require('../koaflow/lib/util/loadConfig');
const App = require('./app');
const {regExitHook} = require("../stat/service/tool/ProcessTool");

const config = loadConfig(`${__dirname}/config`);
// process.env.PORT = config.port;
// process.env.SERVICE = config.SERVICE;
const app = new App(config);

module.exports = app;

// ----------------------------------------------------------------------------
if (process.mainModule.filename === __filename) {
  console.log(`....... start compiler app, port ${config.port} ..........`);
  regExitHook();
  app.start().catch((err) => {
    console.log('error when running:', err);
  });
}
