const util = require('util');
const lodash = require('lodash');
const { Gauge, Counter, Summary } = require('prome-string');

class Prometheus {
  constructor({ ...tags } = {}) {
    this.tags = lodash.pickBy(tags, (v) => v !== undefined);
    const KEYS = Object.keys(this.tags);

    this.table = {
      gauge: new Gauge({
        name: 'counter',
        help: '',
        labels: [...KEYS, 'name'],
      }),

      holderEpoch: new Gauge({
        name: 'holder_epoch',
        help: '',
        labels: [...KEYS, 'address'],
      }),

      quoteUpdateAt: new Gauge({
        name: 'quote_update_at',
        help: '',
        labels: [...KEYS, 'address'],
      }),

      callDuration: new Summary({
        name: 'call_duration',
        help: '',
        labels: [...KEYS, 'module', 'method'],
        queueLength: 1000,
        percentiles: [0.5, 0.8, 0.9, 0.99],
        timeout: 24 * 3600 * 1000,
      }),

      callCounter: new Counter({
        name: 'call_counter',
        help: '',
        labels: [...KEYS, 'module', 'method'],
      }),

      requestCounter: new Counter({
        name: 'request_counter',
        help: '',
        labels: [...KEYS, 'ip'],
      }),
    };
  }

  setGauge(name, count) {
    if (count !== undefined) {
      this.table.gauge.set(count, { ...this.tags, name });
    }
  }

  setHolderEpoch(address, epochNumber) {
    if (epochNumber !== undefined) {
      this.table.holderEpoch.set(epochNumber, { ...this.tags, address });
    }
  }

  setQuoteUpdateAt(address, updateAt) {
    if (updateAt) {
      this.table.quoteUpdateAt.set(updateAt, { ...this.tags, address });
    }
  }

  addRequest(ip) {
    if (lodash.isString(ip)) {
      this.table.requestCounter.add(1, { ...this.tags, ip });
    }
  }

  traceMethod(object, name, callback = () => ({})) {
    const prometheus = this;
    const func = object[name];

    object[name] = async function (...args) {
      const label = { ...prometheus.tags, ...callback(...args) };

      const timestamp = Date.now();
      try {
        return await func.call(this, ...args);
      } finally {
        prometheus.table.callCounter.add(1, label);
        prometheus.table.callDuration.set(Date.now() - timestamp, label);
      }
    };
  }

  traceModule(object) {
    const descriptors = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(object));

    lodash.forEach(descriptors, (descriptor, name) => {
      // XXX: only `public` and `async` function to be trace
      if (!name.startsWith('_') && util.types.isAsyncFunction(descriptor.value)) {
        this.traceMethod(object, name, () => ({ module: object.constructor.name, method: name }));
      }
    });
  }

  toString() {
    return Object.values(this.table).join('\n');
  }
}

module.exports = Prometheus;
