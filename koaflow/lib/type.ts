const lodash = require('lodash');
const parser = require('./parser');

export const type = new Proxy(() => undefined, {
  apply(target, thisArg, argArray) {
    return parser(...argArray);
  },
}) as any;

type.any = type(v => v);
type.undefined = type.any.$validate(lodash.isUndefined);
type.null = type.any.$validate(lodash.isNull);
type.boolean = type.any.$validate(lodash.isBoolean);
type.string = type.any.$validate(lodash.isString);
type.number = type.any.$validate(Number.isFinite);
type.integer = type.any.$validate(Number.isInteger);
type.array = type.any.$validate(Array.isArray);
type.object = type.any.$validate(lodash.isPlainObject);
type.buffer = type.any.$validate(Buffer.isBuffer);

type.nul = type.null.$parse(v => ({ '': null, 'null': null })[v]);
type.bool = type.boolean.$parse(v => ({ false: false, true: true })[v]);
type.num = type.number.$parse(v => (v.length ? Number(v) : v));
type.int = type.integer.$parse(v => (v.length ? Number(v) : v));
type.uint = type.int.$validate(v => v >= 0, 'uint');
type.arr = type.array.$parse(v => v.split(','));
type.obj = type.object.$parse(JSON.parse);

type.hex = type.string.$validate(v => /^(0x)?[0-9a-f]*$/i.test(v), 'hex');
type.json = type.string.$validate(v => JSON.parse(v) || true, 'json');
type.str = type.string.$parse(v => v.trim()).$validate(v => v.length, 'str');

// module.exports = type;
