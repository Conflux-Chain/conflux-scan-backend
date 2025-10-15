const superagent = require('superagent');
const {loadConfig} = require('../koaflow/lib/util/loadConfig');
const {ApiApp} = require('./app');
const {repeatHeartBeat, KEY_SCAN_API, doHeartBeat, KEY_COMPILER, HeartBeatBean} = require("../stat/model/HeartBeat");

const config = loadConfig(`${__dirname}/config`);

// check verification health
setInterval(async ()=>{
  const url = `${config.contractVerificationUrl}/health`;
  try {
    await superagent.get(url)
      .timeout({response: 3_000, deadline: 3_000})
      .then( ack => {
          if(ack?.text !== "Alive and kicking!") {
            throw new Error("No response!")
          }
        }
      )
    if (!HeartBeatBean.sequelize) {
      console.log(`${__filename} DB has not been initialized`)
      return
    }
    await doHeartBeat(`${KEY_COMPILER}_${config.machine}`);
  } catch (e) {
    console.log(`Failed to check verification health ${url}\n ${e.status} ${e.message}`);
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
