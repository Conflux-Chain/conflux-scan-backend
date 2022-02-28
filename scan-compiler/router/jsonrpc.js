const JsonRPCFlow = require('koaflow/lib/flow/JsonRPCFlow');
const parameter = require('koaflow/lib/parameter');
const type = require('../../common/type');

const jsonrpc = new JsonRPCFlow();

// ----------------------------------------------------------------------------
jsonrpc.method('listVersion',
  parameter(),

  async function () {
    const {
      app: { service },
    } = this;

    return service.listVersion();
  },
);

jsonrpc.method('loadVersion',
  parameter({
    version: { path: '0', type: type.str, required: true },
  }),

  async function ({ version }) {
    const {
      app: { service },
    } = this;

    const solCompiler = await service.loadVersion(version);
    return { version: solCompiler.version() };
  },
);

jsonrpc.method('compile',
  parameter({
    version: { path: '0', type: type.str, default: 'latest' },
    sourceCode: { path: '0', type: type.string, required: true },
    filename: { path: '0', type: type.string },
    optimizeRuns: { path: '0', type: type.uint },
    libraries: { path: '0', type: type.object },
  }),

  async function (options) {
    const {
      app: { service },
    } = this;

    return service.compile(options);
  },
);

jsonrpc.method('decompile',
  parameter({
    code: { path: '0', type: type.hex, required: true },
  }),

  function (options) {
    const {
      app: { service },
    } = this;

    return service.decompile(options);
  },

  type({
    metadata: {
      solc: type.solcVersion,
      ipfs: type.bufferToHex,
      bzzr0: type.bufferToHex,
      bzzr1: type.bufferToHex,
    },
  }),
);

jsonrpc.method('verify',
  parameter({
    address: { path: '0', type: type.string },
    code: { path: '0', type: type.hex, required: true },
    name: { path: '0', type: type.string, required: true },
    sourceCode: { path: '0', type: type.string, required: true },
    compiler: { path: '0', type: type.str, default: 'latest' },
    optimizeRuns: { path: '0', type: type.uint },
    license: { path: '0', type: type.string },

    filename: { path: '0', type: type.string },
    libraries: { path: '0', type: type.object },
  }),

  function (options) {
    const {
      app: { service },
    } = this;

    return service.verify(options);
  },
);

module.exports = jsonrpc;
