const assert = require('assert');
const lodash = require('lodash');
const {ConfigInstance} = require("../../stat/config/StatConfig");
const {dingMsg} = require("../../stat/monitor/Monitor");

const SEND_COOL_DELTA = 10 * 1000;
let lastSendTimestamp = 0;

function durationAlarmFlow(threshold, object = {}) {
  assert(threshold > 0, `threshold must > 0, got ${threshold}`);
  assert(lodash.isPlainObject(object), `object must be plain object, got ${object}`);

  return async function (options, next, end) {
    const startTimestamp = Date.now();
    let error;
    try {
      return await next(options);
    } catch (e) {
      error = e;
      throw e;
    } finally {
      const endTimestamp = Date.now();
      const duration = endTimestamp - startTimestamp;
      const sendDelta = endTimestamp - lastSendTimestamp;

      if (duration >= threshold && sendDelta > SEND_COOL_DELTA) {
        dingMsg(JSON.stringify({
          title: 'Method execute too long',
          ...object,
          threshold,
          duration,
          options,
          error: error ? lodash.pick(error, ['name', 'message', 'stack']) : undefined,
        }), ConfigInstance?.dingTalkToken).then();

        lastSendTimestamp = Date.now();
      }
      end();
    }
  };
}

module.exports = durationAlarmFlow;
