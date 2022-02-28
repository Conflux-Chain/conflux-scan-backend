const lodash = require('lodash');
const csvStringify = require('csv-stringify/lib/sync');

function arrayToCSVFlow(fields = []) {
  return async function (options, next) {
    const array = lodash.map(options,
      (each) => lodash.map(fields, (key) => lodash.get(each, key)),
    );
    return next(csvStringify([fields, ...array]));
  };
}

module.exports = arrayToCSVFlow;
