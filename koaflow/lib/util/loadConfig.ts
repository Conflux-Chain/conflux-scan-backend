/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
const path = require('path');

export function loadConfig(dir, env = '') {
  function load(name) {
    try {
      return require(path.resolve(dir, name));
    } catch (e) {
      return {};
    }
  }

  return { ...load(''), ...load(env), ...load('local') };
}

// module.exports = loadConfig;
