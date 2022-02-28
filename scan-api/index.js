const loadConfig = require('koaflow/lib/util/loadConfig');
const App = require('./app');

const config = loadConfig(`${__dirname}/config`);

const app = new App(config);

module.exports = app;

// ----------------------------------------------------------------------------
if (process.mainModule.filename === __filename) {
  app.run().catch((err) => {
    // eslint-disable-next-line no-console
    console.log('error when running:', err);
  }).finally(() => app.close().finally(()=>{
    process.exit(0)
  }));
}
