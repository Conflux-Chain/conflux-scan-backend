const assert = require('assert');

function concurrenceControl(limit) {
  assert(Number.isInteger(limit) && limit > 0, `limit must > 0, got ${limit}`);

  let concurrence = 0;
  return async function (options, next) {
    const {
      app: { error },
    } = this;

    if (concurrence >= limit) {
      throw new error.ApiBusyError(`api is busy concurrence=${concurrence} >= limit=${limit}, try again later`);
    }

    try {
      concurrence += 1;
      return await next(options);
    } finally {
      concurrence -= 1;
    }
  };
}

module.exports = concurrenceControl;
