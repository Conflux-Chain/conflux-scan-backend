const lodash = require('lodash');
const {CONST} = require('../../stat/service/common/constant');

function listLimitBy(fields) {
  return async function (options, next) {
    const {
      app: { error },
    } = this;

    if (lodash.some(fields, (field) => options[field] !== undefined)) {
      const { skip, limit, minEpochNumber, maxEpochNumber } = options;
      const listLimit = CONST.LIST_LIMIT;

      if ((skip + limit) > listLimit) {
        throw new error.ParameterError(
          `skip(${skip}) + limit(${limit}) > listLimit(${listLimit}) while exist any of [${fields.join(',')}]`,
        );
      }
      options.listLimit = listLimit;

      if (minEpochNumber && maxEpochNumber && minEpochNumber > maxEpochNumber) {
        throw new error.ParameterError(
          `maxEpochNumber(${maxEpochNumber}) should >= minEpochNumber(${minEpochNumber})`,
        );
      }
    }

    return next(options);
  };
}

module.exports = listLimitBy;
