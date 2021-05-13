module.exports = {
  env: {
    commonjs: true,
    es6: true,
    node: true,
    jest: true,
  },
  extends: 'airbnb-base',
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly',
    BigInt: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
  },
  rules: {
    'semi': 1,
    'quotes': 1,
    'no-trailing-spaces': 1,
    'arrow-spacing': 1,
    'arrow-parens': 1,
    'arrow-body-style': 0, // for long lambda
    'class-methods-use-this': 0,
    'func-names': 0, // for router
    'function-paren-newline': 0, // for func(arg1,\n arg2)
    'linebreak-style': 0, // for Windows
    'max-classes-per-file': 0,
    'max-len': 0, // for doc
    'no-await-in-loop': 0, // async for loop
    'no-lonely-if': 0, // for countAndList filter
    'no-restricted-syntax': 0, // async for loop
    'no-param-reassign': 0, // for update param
    'no-underscore-dangle': 0, // for _xxx as private method
    'object-curly-newline': 0, // for object keys in one line
    'object-curly-spacing': 1,
    'object-property-newline': 0, // for object key in multi lines
  },
};
