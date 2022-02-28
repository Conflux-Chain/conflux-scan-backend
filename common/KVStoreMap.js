const lodash = require('lodash');
const KVStore = require('@conflux-lib/kvstore');
const CBOR = require('@conflux-lib/cbor');
const LockSet = require('./lib/LockSet');

class KVStoreMap extends KVStore {
  constructor(options) {
    super(options);
    this.lockSet = new LockSet();
  }

  async get(key) {
    try {
      return CBOR.decode(await super.get(key));
    } catch (e) {
      return undefined;
    }
  }

  async set(key, value) {
    try {
      await super.set(key, CBOR.encode(value));
    } catch (e) {
      // pass
    }
  }

  async cache(key, func, {
    isLoad = false,
    isSave = false,
  } = {}) {
    const getIsLoad = lodash.isFunction(isLoad) ? isLoad : () => isLoad;
    const getIsSave = lodash.isFunction(isSave) ? isSave : () => isSave;

    return this.lockSet.lock(key, async () => {
      let value = await this.get(key);
      let reload = false;

      if (value === undefined || await getIsLoad(value)) {
        value = await func();
        reload = true;
      }

      if (reload && await getIsSave(value)) {
        await this.set(key, value);
      }

      return value;
    });
  }
}

module.exports = KVStoreMap;
