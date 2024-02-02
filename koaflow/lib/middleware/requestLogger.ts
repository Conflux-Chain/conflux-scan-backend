const lodash = require('lodash');

/**
 * @param {object} ctx
 * @param {object} keyToPath: {string:<true|string|function>, ...}
 *   true: use `keyToDefaultPath` value
 *   string: get attribute from ctx
 *   function: get attribute by function(ctx)
 * @param {object} keyToDefaultPath: {string:<true|string|function>, ...}
 * @return {object}
 *
 * @example
 > pick(ctx, {url: true}, {url: 'request.url'}) // url === ctx.request.url
 > pick(ctx, {body: 'response.body'}) // body === ctx.response.body
 > pick(ctx, {array: (ctx)=>ctx.request.url.split('/')})
 */
function pick(ctx, keyToPath, keyToDefaultPath = {}) {
  const info = {};

  lodash.forEach(keyToPath, (path, key) => {
    if (path === true) {
      path = keyToDefaultPath[key];
    }

    let value;
    if (typeof path === 'string') {
      value = lodash.get(ctx, path);
    } else if (lodash.isFunction(path)) {
      value = path(ctx);
    }

    lodash.set(info, key, value);
  });

  return info;
}

/**
 *
 * @param {object} logger
 * @param {object} requestConfig: {string:<true|string|function>, ...}
 * @param {object} responseConfig: {string:<true|string|function>, ...}
 * @param {string} level
 * @param {string|function} format
 * @return {Function}
 */
export function requestLogger(logger, {
  request: requestConfig = { timestamp: true, method: true, url: true },
  response: responseConfig = { status: true, length: true, duration: true },
  level = 'info',
  format = 'json' as any,
} = {}) {
  switch (format) {
    case 'readable':
      format = v => JSON.stringify(v, null, 2);
      break;

    case 'json':
      format = v => JSON.stringify(v);
      break;

    case 'object':
      format = v => v;
      break;

    default:
      if (!lodash.isFunction(format)) {
        throw new Error(`format should be one of ['readable', 'json', 'object'] or a function, got "${format}"`);
      }
      break;
  }

  return async function (ctx, next) {
    const timestamp = Date.now();

    try {
      await next();
    } finally {
      if (logger) {
        const info = {} as any;

        info.request = pick(ctx, requestConfig, {
          timestamp: () => timestamp,
          http: 'req.httpVersion',
          method: 'request.method',
          url: 'request.url',
          params: 'params',
          query: 'request.query',
          header: 'request.header',
          body: 'request.body',
        });

        info.response = pick(ctx, responseConfig, {
          duration: () => Date.now() - timestamp,
          length: 'response.length',
          status: 'response.status',
          message: 'response.message',
          header: 'response.header',
          body: 'response.body',
        });

        logger[level](format(info));
      }
    }
  };
}

// module.exports = requestLogger;
