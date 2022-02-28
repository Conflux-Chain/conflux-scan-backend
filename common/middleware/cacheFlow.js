const assert = require('assert');
const lodash = require('lodash');

function cacheFlow(ttl) {
  assert(ttl > 0, `ttl must > 0, got ${ttl}`);

  const flowId = lodash.random(Number.MAX_SAFE_INTEGER);

  return async function (options, next, end) {
    const {
      app: { ttlMap },
    } = this;

    const key = `${flowId}/${JSON.stringify(options)}`;
    const result = await ttlMap.cache(key,
      () => next(options),
      { ttl },
    );

    return end(result); // use end to break flow if next not called
  };
}

module.exports = cacheFlow;
