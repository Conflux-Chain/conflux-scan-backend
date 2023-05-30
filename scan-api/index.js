const loadConfig = require('koaflow/lib/util/loadConfig');
const App = require('./app');

const config = loadConfig(`${__dirname}/config`);

const app = new App(config);

module.exports = app;

// ----------------------------------------------------------------------------
if (process.mainModule.filename === __filename) {
  console.log(`....... start api app, port ${config.port} ..........`);
  app.start().catch((err) => {
    console.log('error when running:', err);
  }).finally(() => app.close());
}
