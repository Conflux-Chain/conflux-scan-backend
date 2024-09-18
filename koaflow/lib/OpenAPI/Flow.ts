const lodash = require('lodash');

const PATH_TABLE = {
  path: 'params',
  query: 'request.query',
  header: 'request.headers',
  cookie: 'cookies',
};

export function pickParameter(input) {
  return (object) => lodash.mapValues(input, (entry, key) => {
    const path = PATH_TABLE[entry.in] || 'request.body';
    const value = lodash.get(object, `${path}.${key}`);
    return value === undefined ? entry.default : value;
  });
}
