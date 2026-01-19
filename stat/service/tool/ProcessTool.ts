import {safeAddErrorLog} from "../../monitor/ErrorMonitor";
import {getAppEntryName} from "./LoggerConfig";

const lodash = require('lodash');

process.on('unhandledRejection', (e) => {
  if (e["message"]?.startsWith('ConnectionManager.getConnection was called after the connection manager was closed!')) {
    console.log(e['message']);
    return
  }
  safeAddErrorLog('stat-task', 'unhandled rejection', e as Error).then();
  console.error(`${new Date().toISOString()} ProcessTool.ts, the process encountered unhandledRejection!\n`, e); // eslint-disable-line no-console
  console.log(`system will exit soon.`)
  const timer = setTimeout(()=>process.exit(9), 15_000)
  safeAddErrorLog(getAppEntryName(), 'system', e as Error).finally(()=>{
    clearTimeout(timer);
    process.exit(9) // restart
  });
});
export function regExitHook() {
  const fn = (signal) => {
    console.log(`----------------------------`)
    console.log(`receive ${signal}, exit now.`)
    console.log(`----------------------------`)
    process.exit(0)
  };
  process.on('SIGINT', fn);
  process.on('SIGTERM', fn);
}

// ----------------------------------------------------------------------------
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms)); // sleep
}

export function registerProcessHook(server) {
  process.on('SIGINT', exitOnSignal(server));
  process.on('SIGTERM', exitOnSignal(server));
}

export function exitOnSignal(server) {
  return async (signal) => {
    console.log(`receive ${signal}...`);
    await server.close();
    console.log(`server shutdown.`);
    process.exit(0);
  }
}
