const lodash = require('lodash');
const csvStringify = require('csv-stringify/lib/sync');

function arrayToCSVFlow() {
  return async function (options, next) {
    const {list, exportFields} = options;

    const filedNameArray = []
    const fieldAliasArray = []
    exportFields.forEach(field => {
      if(Array.isArray(field)) {
        filedNameArray.push(field[0])
        fieldAliasArray.push(field.length > 1 ? field[1] : field[0])
      } else{
        filedNameArray.push(field)
        fieldAliasArray.push(field)
      }
    })

    const array = lodash.map(list, (each) => lodash.map(filedNameArray, (key) => lodash.get(each, key)),);
    return next(csvStringify([fieldAliasArray, ...array]));
  };
}

module.exports = arrayToCSVFlow;
