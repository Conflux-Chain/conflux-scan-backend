const util = require('util');
const lodash = require('lodash');
const {parameterErrorCode} = require('./error')
// ----------------------------------------------------------------------------
const EMPTY_LOGGER = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
};

const DEFAULT_OPTIONS = {
  level: 'info',
  params: (param) => param,
  result: () => undefined,
  error: (e) => e.stack.split('\n'),
};

// ----------------------------------------------------------------------------
class TraceLog {
  constructor() {
  }

  /**
   * Trace method `method` of object and log params and result or error.
   *
   * @param object {Object}
   * @param method {string}
   * @param [options] {object}
   *
   * @example
   * traceLog.traceMethod(app, 'listen', {
   *   params: (...args) => args[0],
   *   result: result => typeof result,
   *   error: e => e.message,
   * })
   */
  traceMethod(object, method, options = {}) {
    lodash.defaults(options, DEFAULT_OPTIONS);

    const func = object[method];

    object[method] = async function (...args) {
      const timestamp = Date.now();
      let result;
      let error;

      try {
        result = await func.call(this, ...args);
        return result;
      } catch (e) {
        error = e;
        throw e;
      } finally {
        const duration = Date.now() - timestamp;
        const module = options.module || object.constructor.name;

        if (error) {
          if (error.code !== parameterErrorCode) {
            console.log('duration', duration, 'module', module, 'method', method, args, error);
          }
        }
      }
    };
  }

  traceModule(object, options) {
    const descriptors = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(object));

    lodash.forEach(descriptors, (descriptor, name) => {
      // XXX: only `public` and `async` function to be trace
      if (!name.startsWith('_') && util.types.isAsyncFunction(descriptor.value)) {
        this.traceMethod(object, name, options);
      }
    });
  }
}

module.exports = TraceLog;
