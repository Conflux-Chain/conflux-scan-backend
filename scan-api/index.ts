const superagent = require('superagent');
const {loadConfig} = require('../koaflow/lib/util/loadConfig');
const {ApiApp} = require('./app');
const {repeatHeartBeat, KEY_SCAN_API, doHeartBeat, KEY_COMPILER, HeartBeatBean} = require("../stat/model/HeartBeat");

const config = loadConfig(`${__dirname}/config`);

// check compiler health
setInterval(async ()=>{
  // remove compiler service, this is a test url with bad address 0xAA
  const compilerRpc = `${config.contractVerificationUrl}/verify/1/0xAA`;
  try {
    await superagent.post(compilerRpc).catch(e=>{
      // above url should return status 400 Bad request, since address 0xAA is invalid.
      // otherwise there may be some error.
      if (e.status !== 400) {
        throw e;
      }
    })
    if (!HeartBeatBean.sequelize) {
      console.log(`${__filename} DB has not been initialized`)
      return
    }
    await doHeartBeat(`${KEY_COMPILER}_${config.machine}`);
  } catch (e) {
    console.log(`failed to call compiler rpc ${compilerRpc}\n ${e.status} ${e.message}`);
  }
}, 10_000)
// report scan api heart beat
repeatHeartBeat(`${KEY_SCAN_API}_${config.machine}`)

export const app = new ApiApp(config);


// ----------------------------------------------------------------------------
if (process.mainModule.filename === __filename) {
  console.log(`....... start api app, port ${config.port} ..........`);
  app.start().catch((err) => {
    console.log('error when running:', err);
  }).finally(() => app.close());
}
