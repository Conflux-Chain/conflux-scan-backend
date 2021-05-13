const lodash = require('lodash');

// ----------------------------------------------------------------------------
let running = true;

process.on('SIGINT', (signal) => {
  console.log(`receive ${signal}`)
  running = false;
});
process.on('SIGTERM', (signal) => {
  console.log(`receive ${signal}`)
  running = false;
});
process.on('unhandledRejection', (e) => {
  console.error(`${new Date().toISOString()} the process encountered unhandledRejection!\n`, e); // eslint-disable-line no-console
  // running = false;
});

export function isRunning() {
  return running;
}

// ----------------------------------------------------------------------------
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms)); // sleep
}
