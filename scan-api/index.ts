import {loadConfig} from "../stat/config/StatConfig";
import {scheduleSwaggerReporter} from "../stat/monitor/swaggerMetrics";

const {ApiApp} = require('./app');
const {repeatHeartBeat, KEY_SCAN_API} = require("../stat/model/HeartBeat");

export async function init() {
  const config = loadConfig('Prod');
  const app = new ApiApp(config);

  await scheduleSwaggerReporter(config.influxDB, config.v1port);
  repeatHeartBeat(`${KEY_SCAN_API}_${config.serverTag}`);

  return app.start()
}
