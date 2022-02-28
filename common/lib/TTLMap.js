const lodash = require('lodash');
const LockSet = require('./LockSet');

class TimerMap extends Map {
  set(key, ttl, callback) {
    this.delete(key);

    const timerId = setTimeout(() => {
      this.delete(key);
      return callback();
    }, ttl);
    super.set(key, timerId);
  }

  delete(key) {
    clearTimeout(this.get(key)); // clearTimeout accept undefined
    super.delete(key);
  }

  clear() {
    for (const timerId of this.values()) {
      clearTimeout(timerId);
    }
    super.clear();
  }
}

// TODO: read and write lock
class TTLMap extends Map {
  constructor() {
    super();
    this.timerMap = new TimerMap();
    this.lockSet = new LockSet();
  }

  set(key, value, ttl = 24 * 60 * 60 * 1000) {
    this.timerMap.set(key, ttl, () => this.delete(key));
    return super.set(key, value);
  }

  async cache(key, func, {
    ttl,
    isLoad = false,
    isSave = true,
  } = {}) {
    const getTTL = lodash.isFunction(ttl) ? ttl : () => ttl;
    const getIsLoad = lodash.isFunction(isLoad) ? isLoad : () => Boolean(isLoad);
    const getIsSave = lodash.isFunction(isSave) ? isSave : () => Boolean(isSave);

    return this.lockSet.lock(key, async () => {
      let value = this.get(key); // `get` first, then check `has`
      let reload = false;

      if (!this.has(key) || await getIsLoad(value)) {
        value = await func();
        reload = true;
      }

      if (reload && await getIsSave(value)) {
        this.set(key, value, await getTTL(value));
      }

      return value;
    });
  }

  clear() {
    this.timerMap.clear();
    this.lockSet.clear();
    super.clear();
  }

  close() {
    return this.clear();
  }
}

module.exports = TTLMap;
