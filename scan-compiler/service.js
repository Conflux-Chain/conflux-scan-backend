const lodash = require('lodash');
const semver = require('semver');
const solc = require('solc');
const cbor = require('cbor');
// const CBOR = require('@conflux-lib/cbor');
const superagent = require('superagent');
require('superagent-proxy')(superagent);

const OPCODES = require('../common/lib/OPCODES.json');

const DOMAIN = 'https://solc-bin.ethereum.org/bin';

/**
 * @see https://docs.soliditylang.org/en/v0.7.5/using-the-compiler.html
 */
class SolCompileService {
  constructor(app) {
    this.app = app;
  }

  async request(url) {
    const { body } = await superagent.get(url)
      .responseType('blob') // return Buffer
      .proxy(process.env.REQUEST_PROXY);
    return body;
  }

  async listVersion(expires = 24 * 60 * 60 * 1000) {
    const {
      app: { ttlMap, fileMap },
    } = this;

    return ttlMap.cache('listVersion', async () => {
      const buffer = await fileMap.cache('list.json',
        () => this.request(`${DOMAIN}/list.json`),
        { expires },
      );

      const { releases, latestRelease } = JSON.parse(buffer);
      return { latest: releases[latestRelease], ...releases };
    });
  }

  async loadVersion(version = 'latest') {
    const {
      app: { tool, error, ttlMap, fileMap },
    } = this;

    return ttlMap.cache(`loadVersion(${version})`, async () => {
      const versionTable = await this.listVersion();

      const filename = versionTable[version];
      if (!filename) {
        throw new error.ParameterError(`version "${version}" not found`);
      }

      const buffer = await fileMap.cache(filename,
        () => this.request(`${DOMAIN}/${filename}`),
      );
      if (!Buffer.isBuffer(buffer)) {
        throw new error.ParameterError(`download "${filename}" failed`);
      }

      return solc.setupMethods(tool.requireJs(buffer.toString()));
    });
  }

  async compile({ sourceCode, version, optimizeRuns, filename, libraries }) {
    const {
      app: { tool, type, fileMap, logger },
    } = this;
    const versionTable = await this.listVersion();
    version = semver.maxSatisfying(Object.keys(versionTable), version) || undefined;
    const solCompiler = await this.loadVersion(version);
    const versionPartial = versionTable[version].substr(8);
    const versionFullName = versionPartial.substr(0, versionPartial.length - 3);

    const input = {
      language: 'Solidity',
      sources: { [filename]: { content: sourceCode } },
      settings: {
        optimizer: { enabled: Number.isInteger(optimizeRuns), runs: optimizeRuns },
        libraries,
        outputSelection: { '*': { '*': ['*'] } },
      },
    };
    const options = {
      import: (path) => {
        const contents = tool.readFile(path) || tool.readCommonContract(path) || tool.readNodeModules(path);
        return contents ? { contents } : { error: `can not found file "${path}"` };
      },
    };

    const inputJson = JSON.stringify(input);
    const outputJson = await fileMap.cache(`compile.${version}.${type.toMD5(inputJson)}.json`,
      () => solCompiler.compile(inputJson, options),
    );

    const output = JSON.parse(outputJson);
    const contracts = lodash.mapValues(
      lodash.get(output.contracts, filename, {}),
      ({ abi, evm }) => {
        const bytecode = `0x${evm.bytecode.object}`;
        const code = `0x${evm.deployedBytecode.object}`;
        return { abi, code, bytecode };
      },
    );
    const errors = lodash.filter(output.errors, (each) => each.severity === 'error');
    const warnings = lodash.filter(output.errors, (each) => each.severity !== 'error');

    return { version: versionFullName, contracts, warnings, errors };
  }

  async decompile({ code }) { // XXX: async for `traceLog.traceMethod`
    const metadataLength = Number(`0x${code.slice(-4)}`); // two-byte big-endian encoding
    const metadataHex = code.slice(-metadataLength * 2 - 4, -4);
    // const metadata = CBOR.decode(Buffer.from(metadataHex, 'hex'));
    const metadata = cbor.decodeFirstSync(Buffer.from(metadataHex, 'hex'));
    const runtimeCode = code.slice(0, -metadataLength * 2 - 4);
    const opcodes = this._disassemble(runtimeCode);

    return { metadata, runtimeCode, opcodes };
  }

  _disassemble(hex) {
    const {
      app: { type },
    } = this;

    const buffer = type.hexToBuffer(hex);

    let dataCount = 0;
    return lodash.map(buffer, (code) => {
      if (dataCount) {
        dataCount -= 1;
        return code;
      }

      const name = OPCODES[code];
      if (!name) {
        return type.intToHex(code);
      }

      if (name.startsWith('PUSH')) {
        dataCount = Number(name.slice(4));
      }

      return name;
    });
  }

  // --------------------------------------------------------------------------
  async verify({ address, code, name, ...options }) {
    const {
      app: { error, type, tool, logger },
    } = this;
    logger.info({ src: `[${address}]verify`, contractName: `${name}`, options, code });

    const { metadata, runtimeCode } = await this.decompile({ code }).catch((e) => {
      throw new error.ContractDecompileError(e);
    });

    options.version = type.solcVersion(metadata.solc) || options.compiler;
    const { version, contracts, warnings, errors } = await this.compile(options).catch((e) => {
      throw new error.CompilerError(e);
    });

    if (errors.length) {
      return { version, warnings, errors };
    }

    const contract = contracts[name];
    logger.info({ src: `[${address}]verify`, contractName: `${name}`, recompiled: `${JSON.stringify(contract)}` });
    if (!contract) {
      throw new error.ContractNameError(`can not found contract "${name}" in ${JSON.stringify(Object.keys(contracts))}`);
    }

    const result = await this.decompile(contract).catch((e) => {
      throw new error.ContractDecompileError(e);
    });
    let exactMatch = runtimeCode === result.runtimeCode;
    if (!exactMatch) {
      const trimmedDeployedBytecode = runtimeCode.substr(0, runtimeCode.indexOf('a265627a'));
      const trimmedCompiledBytecode = result.runtimeCode.substr(0, result.runtimeCode.indexOf('a265627a'));
      exactMatch = trimmedDeployedBytecode === trimmedCompiledBytecode;
    }
    const similarity = tool.calculateSimilarity(type.hexToBuffer(runtimeCode), type.hexToBuffer(result.runtimeCode));
    const { abi, bytecode } = contract;

    const verifyResult = { version, warnings, errors, exactMatch, similarity, abi, bytecode };
    logger.info({ src: `[${address}]verify`, contractName: `${name}`, verifyResult: `${JSON.stringify(verifyResult)}` });
    return verifyResult;
  }
}

module.exports = SolCompileService;
