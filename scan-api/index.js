const superagent = require('superagent');
const loadConfig = require('koaflow/lib/util/loadConfig');
const App = require('./app');
const {HeartBeatBean, repeatHeartBeat, KEY_SCAN_API, doHeartBeat, KEY_COMPILER} = require("../stat/dist/model/HeartBeat");

const config = loadConfig(`${__dirname}/config`);

// check compiler health
const proxy = config.sync.proxy;
const compilerRpc = proxy[Object.keys(proxy)[0]];
setInterval(async ()=>{
  try {
    await superagent.get(compilerRpc)
    await HeartBeatBean.upsert({key: KEY_COMPILER, updatedAt: new Date()})
  } catch (e) {
    console.log(`failed to call compiler rpc ${compilerRpc}`, e)
  }
}, 10_000)
// report scan api heart beat
repeatHeartBeat(KEY_SCAN_API)

const app = new App(config);

module.exports = app;

// ----------------------------------------------------------------------------
if (process.mainModule.filename === __filename) {
  console.log(`....... start api app, port ${config.port} ..........`);
  app.start().catch((err) => {
    console.log('error when running:', err);
  }).finally(() => app.close());
}
