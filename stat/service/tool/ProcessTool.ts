const lodash = require('lodash');

// Use `setTime(cb, 0)` instead of while(isRunning())
// ----------------------------------------------------------------------------
// let running = true;
//
// process.on('SIGINT', (signal) => {
//   console.log(`receive ${signal}`)
//   running = false;
// });
// process.on('SIGTERM', (signal) => {
//   console.log(`receive ${signal}`)
//   running = false;
// });
process.on('unhandledRejection', (e) => {
  console.error(`${new Date().toISOString()} ProcessTool.ts, the process encountered unhandledRejection!\n`, e); // eslint-disable-line no-console
  // running = false;
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
