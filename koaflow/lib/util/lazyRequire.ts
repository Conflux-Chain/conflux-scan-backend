/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
const path = require('path');

export function lazyRequire(dir) {
  return (...args) => new Proxy({}, {
    get(self, key) {
      if (!(key in self)) {
        const func = require(path.resolve(dir, key));
        self[key] = func(...args);
      }
      return self[key];
    },
  });
}

// module.exports = lazyRequire;
