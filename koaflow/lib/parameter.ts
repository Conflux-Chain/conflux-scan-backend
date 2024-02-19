const lodash = require('lodash');

export class ParameterError extends Error {}

function compileEntry(key, {
  path,
  type = v => v,
  'default': _default,
  required = false,
  'enum': _enum,
  ...conditions
}) {
  const getDefault = lodash.isFunction(_default) ? _default : () => _default;
  const isRequired = lodash.isFunction(required) ? required : () => required;
  const enumSet = _enum ? new Set(_enum) : undefined;
  if (!lodash.every(conditions, lodash.isFunction)) {
    throw new ParameterError(`not every conditions [${Object.keys(conditions).join(',')}] are function`);
  }

  return (src, dist) => {
    const fillPath = path ? `${path}.${key}` : key;

    // 检查已验证过的参数
    let value = lodash.get(dist, fillPath);

    // 检查原始参数
    if (value === undefined) {
      value = lodash.get(src, fillPath);
    }

    // 检查是否必填
    // @ts-ignore
    if (value === undefined && isRequired(dist)) {
      throw new ParameterError(`"${fillPath}" is required`);
    }

    // 获取默认值
    if (value === undefined) {
      value = getDefault(dist);
    }

    // 没有默认值将直接返回
    if (value === undefined) {
      return undefined;
    }

    // 检查格式
    try {
      value = type(value);
    } catch (e) {
      throw new ParameterError(`"${fillPath}" error with "${e.message}"`);
    }

    // 检查枚举
    if (enumSet && !enumSet.has(value)) {
      throw new ParameterError(`"${fillPath}" do not match enum {${[...enumSet].join(',')}}, got: ${value}`);
    }

    // 附加检查条件
    for (const [name, condition] of Object.entries(conditions)) {
      if (!condition(value, dist)) {
        throw new ParameterError(`"${fillPath}" do not match condition "${name}", got: ${value}`);
      }
    }

    return value;
  };
}

export function parameter(options) {
  const keyToEntry = {};
  lodash.forEach(options, (schema, key) => {
    keyToEntry[key] = compileEntry(key, schema);
  });

  return (object) => {
    const result = {};
    for (const [key, entry] of Object.entries(keyToEntry)) {
      // @ts-ignore
      const value = entry(object, result);
      if (value !== undefined) {
        lodash.set(result, key, value);
      }
    }
    return result;
  };
}

// module.exports = parameter;
// module.exports.ParameterError = ParameterError;
