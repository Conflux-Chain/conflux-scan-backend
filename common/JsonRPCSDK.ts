const lodash = require('lodash');
const { providerFactory } = require('js-conflux-sdk');

const OPTIONS = {
  clientConfig: {
    maxReceivedFrameSize: 10 * 1024 * 1024, // 10 MiB
    maxReceivedMessageSize: 100 * 1024 * 1024, // 100 MiB
  },
};

export class JsonRPCSDK {
  config: any;
  provider: unknown;
  private readonly proxyToProvider: any;
  private readonly _methodToProvider: {};
  constructor(config = {}) {
    this.config = config;

    const { url, proxy, ...options } = this.config;
    this.provider = providerFactory({ url, ...OPTIONS, ...options });
    this.proxyToProvider = lodash.mapValues(proxy,
      (each) => providerFactory(lodash.isString(each) ? { url: each, ...OPTIONS, ...options } : each),
    );

    this._methodToProvider = {};
    return new Proxy(this, this.constructor);
  }

  static get(self, key) {
    if (Reflect.has(self, key)) {
      return Reflect.get(self, key);
    }
    return (...args) => self.call(key, ...args); // bounded method
  }

  getProvider(method) {
    if (Reflect.has(this._methodToProvider, method)) {
      return this._methodToProvider[method];
    }

    let { provider } = this;
    for (const [key, value] of Object.entries(this.proxyToProvider)) {
      const regex = new RegExp(key);
      if (regex.test(method)) {
        provider = value;
        break;
      }
    }

    this._methodToProvider[method] = provider;
    // @ts-ignore
    provider.setMaxListeners(100);
    return provider;
  }

  call(method, ...args) {
    return this.getProvider(method).call(method, ...args);
  }

  toJSON() {
    return this.config;
  }

  close() {
    // @ts-ignore
    this.provider.close();
    lodash.forEach(this.proxyToProvider, (provider) => provider.close());
  }
}
