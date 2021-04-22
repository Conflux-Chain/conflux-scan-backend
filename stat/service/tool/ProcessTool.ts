const lodash = require('lodash');

// ----------------------------------------------------------------------------
let running = true;

process.on('SIGINT', () => {
  running = false;
});
process.on('SIGTERM', () => {
  running = false;
});
process.on('unhandledRejection', (e) => {
  console.error(e); // eslint-disable-line no-console
  running = false;
});

export function isRunning() {
  return running;
}

// ----------------------------------------------------------------------------
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms)); // sleep
}
