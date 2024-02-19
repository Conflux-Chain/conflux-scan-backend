const {parameter: KoaParameter} = require('../koaflow/lib/parameter');

function parameter(schema) {
  const func = KoaParameter(schema);

  return function (options) {
    const {
      app: { error },
    } = this;

    try {
      return func(options);
    } catch (e) {
      throw new error.ParameterError(e);
    }
  };
}

module.exports = parameter;
