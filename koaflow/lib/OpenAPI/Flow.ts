const assert = require('assert');
const lodash = require('lodash');

const PATH_TABLE = {
  path: 'params',
  query: 'request.query',
  header: 'request.headers',
  cookie: 'cookies',
};

const PARAM_FIELD = [
  'name', 'in', 'description', 'required', 'deprecated', 'allowEmptyValue',
  'schema', 'style', 'explode', 'allowReserved', 'example', 'examples',
];

const PARAM_SCHEMA_FIELD = [
  'type', 'format', 'enum', 'default', 'nullable',
  'minimum', 'exclusiveMinimum', 'maximum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern',
  'minItems', 'maxItems', 'uniqueItems', 'items',
  'minProperties', 'maxProperties', 'properties', 'additionalProperties',
  // allOf, oneOf, anyOf, not
];

const BODY_SCHEMA_FIELD = [...PARAM_SCHEMA_FIELD, 'description', 'deprecated', 'example'];

// ----------------------------------------------------------------------------
function typeSchema(arg) {
  if (arg === undefined) {
    return undefined;
  }
  if (lodash.isPlainObject(arg)) {
    return { type: 'object', properties: lodash.mapValues(arg, typeSchema) };
  }
  if (Array.isArray(arg)) {
    return { type: 'array', items: typeSchema(lodash.first(arg)) || {} };
  }
  if (lodash.isString(arg)) {
    return { type: arg };
  }
  return arg;
}

function formatParameters(object) {
  return lodash.map(object, ({ type, ...entry }, name) => {
    const schema = { ...typeSchema(type), ...lodash.pick(entry, PARAM_SCHEMA_FIELD) };
    return lodash.pick({ name, schema, ...entry }, PARAM_FIELD);
  });
}

function formatRequestBody(object) {
  const required = [];
  const properties = lodash.mapValues(object, ({ type, ...entry }, name) => {
    if (entry.required) {
      required.push(name);
    }
    return { ...typeSchema(type), ...lodash.pick(entry, BODY_SCHEMA_FIELD) };
  });

  const schema = {
    type: 'object',
    properties,
    required: lodash.isEmpty(required) ? undefined : required,
  };

  return lodash.isEmpty(object) ? undefined : {
    content: {
      'application/json': { schema },
    },
  };
}

function formatResponses(output) {
  return lodash.mapValues(output, (schema, code) => {
    assert(/^\d+$/.test(code), `status code must be integer, got ${code}`);

    return {
      description: '',
      content: {
        'application/json': {
          schema: typeSchema(schema),
        },
      },
    };
  });
}

function pickParameter(input) {
  return (object) => lodash.mapValues(input, (entry, key) => {
    const path = PATH_TABLE[entry.in] || 'request.body';
    const value = lodash.get(object, `${path}.${key}`);
    return value === undefined ? entry.default : value;
  });
}

function pickBody(schema) {
  if (lodash.isPlainObject(schema)) {
    const map = lodash.mapValues(schema, pickBody);
    return o => (o === undefined ? o : lodash.mapValues(map, (f, k) => f(lodash.get(o, k))));
  }

  if (Array.isArray(schema)) {
    const each = pickBody(lodash.first(schema));
    return a => (a === undefined ? a : lodash.map(a, each));
  }

  return v => v;
}

// ----------------------------------------------------------------------------
export class Flow {
  private object: any;
  private input: (object) => any;
  private output: any;
  constructor({ input, output, ...rest }) {
    this.object = {
      parameters: formatParameters(lodash.pickBy(input, entry => PATH_TABLE[entry.in])),
      requestBody: formatRequestBody(lodash.pickBy(input, entry => !PATH_TABLE[entry.in])),
      responses: formatResponses(output),
      ...rest,
    };

    this.input = pickParameter(input);
    this.output = lodash.mapValues(output, pickBody);
  }

  async call(ctx, arg, next, end) {
    let body;

    try {
      body = await next(this.input(arg));

      ctx.body = body; // to got ctx.status
      // const picker = this.output[ctx.status] || (v => v);
      // body = picker(body);
    } catch (e) {
      ctx.methodFlowError = e;
      if (e.name == 'ParameterError') {
        console.log(`${__filename} catches param error \n url: ${ctx.originalUrl} \n`, e.message)
      } else {
        console.log(`${__filename} catches unknown error \n url: ${ctx.originalUrl} \n`, e)
      }
      // ctx.status = e.status || 500;
      // const picker = this.output[ctx.status] || (() => undefined);
      // body = picker(e);

      end();
    }

    return body;
  }
}

// module.exports = Flow;
