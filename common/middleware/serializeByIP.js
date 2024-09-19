const assert = require('assert');
const LockSet = require('../lib/LockSet');
const KeyCounter = require('../lib/KeyCounter');
const {getClientIP} = require("../../stat/router/RateLimiter");

function serializeByIP(limit = 100) {
  assert(Number.isInteger(limit) && limit > 0, `limit must > 0, got ${limit}`);

  const lockSet = new LockSet();
  const keyCounter = new KeyCounter();

  return async function (options, next) {
    const {
      app: { error },
    } = this;

    const ip = this.request ? getClientIP(this) : undefined;
    if (!ip) {
      return next(options);
    }

    const length = keyCounter.get(ip);
    if (length >= limit) {
      throw new error.ApiBusyError(`request queue too long, length=${length} >= limit=${limit}, try again later`);
    }

    try {
      keyCounter.inc(ip);
      return await lockSet.lock(ip, () => next(options));
    } finally {
      keyCounter.dec(ip);
    }
  };
}

module.exports = serializeByIP;
