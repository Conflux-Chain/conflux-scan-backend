const loadConfig = require('koaflow/lib/util/loadConfig');
const App = require('./app');

const config = loadConfig(`${__dirname}/config`);
// process.env.PORT = config.port;
// process.env.SERVICE = config.SERVICE;
const app = new App(config);

module.exports = app;

// ----------------------------------------------------------------------------
if (process.mainModule.filename === __filename) {
  app.listen(config.port);
  // eslint-disable-next-line no-console
  console.log(`....... start compiler app, port ${config.port} ..........`);
  app.run().finally(() => app.close());
}
