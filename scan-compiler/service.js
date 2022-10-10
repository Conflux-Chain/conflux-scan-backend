const path = require('path');
const lodash = require('lodash');
const semver = require('semver');
const solc = require('solc');
const cbor = require('cbor');
const superagent = require('superagent');
require('superagent-proxy')(superagent);

const OPCODES = require('../common/lib/OPCODES.json');
const DOMAIN = 'https://solc-bin.ethereum.org/bin';
const {extractEncodedConstructorArgs} = require('../common/tool');

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
      return { /*latest: releases[latestRelease],*/ ...releases };
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

      const solJsonPath = path.resolve(fileMap.location, filename);
      return solc.setupMethods(require(solJsonPath));
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
        const creationBytecode = `0x${evm.bytecode.object}`;
        const deployedBytecode = `0x${evm.deployedBytecode.object}`;
        return { abi, creationBytecode, deployedBytecode };
      },
    );
    const errors = lodash.filter(output.errors, (each) => each.severity === 'error');
    const warnings = lodash.filter(output.errors, (each) => each.severity !== 'error');

    return { version: versionFullName, contracts, warnings, errors };
  }

  async decompile({ code }) { // XXX: async for `traceLog.traceMethod`
    const metadataLength = Number(`0x${code.slice(-4)}`);
    const metadataHex = code.slice(-metadataLength * 2 - 4, -4);
    const metadata = cbor.decodeFirstSync(Buffer.from(metadataHex, 'hex'));
    const runtimeCode = code.slice(0, -metadataLength * 2 - 4);
    const opcodes = this._disassemble(runtimeCode);

    return { metadata, runtimeCode, opcodes };
  }

  async extractMetadata(bytecode) {
    const metadataSize = parseInt(bytecode.slice(-4), 16) * 2 + 4;
    const metadataHex = bytecode.slice(-metadataSize, -4);
    const metadata = cbor.decodeFirstSync(Buffer.from(metadataHex, 'hex'));
    return metadata;
  }

  _trimMetadata(bytecode) {
    // Last 4 chars of bytecode specify byte size of metadata component
    const metadataSize = parseInt(bytecode.slice(-4), 16) * 2 + 4;
    let trimmedMetadata = bytecode.slice(0, bytecode.length - metadataSize);
    // filter mata data hash, that is bzzr1 hash or ipfs hash
    const prefixArray = ['a265627a7a723158', 'a2646970667358'];
    prefixArray.forEach(prefix => {
      if (trimmedMetadata.indexOf(prefix) !== -1) {
        trimmedMetadata = trimmedMetadata.substr(0, trimmedMetadata.indexOf(prefix));
      }
    });
    return trimmedMetadata;
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
  async verifyPlus({ address, creationData, deployedBytecode, name, ...options }) {
    const {
      app: {CONST: {MATCH_STATUS}, error, type, logger},
    } = this;

    const match = {
      address,
      version: null,
      warnings: null,
      errors: null,
      abi: null,
      creationBytecode: null,
      encodedConstructorArgs: null,
      matchCode: null,
      matchDesc: null,
    };

    if (!deployedBytecode || deployedBytecode === '0x') {
      lodash.assign(match, MATCH_STATUS.CODE_NOT_FOUND, {warnings: [], errors: []});
      return match;
    }

    const metadata = await this.extractMetadata(deployedBytecode).catch(e => {throw new error.ExtractMetadataError(e)});
    options.version = type.solcVersion(metadata.solc) || options.compiler;
    const {contracts, version, warnings, errors} = await this.compile(options).catch(e => {throw new error.CompilerError(e)});
    lodash.assign(match, {version, warnings, errors});
    if (errors?.length) {
      lodash.assign(match, MATCH_STATUS.ERROR);
      return match;
    }

    const recompiled = contracts[name];
    if (!recompiled) {
      throw new error.ContractNameError(`can not found contract:${name} in ${JSON.stringify(Object.keys(contracts))}`);
    }
    lodash.assign(match, lodash.pick(recompiled, ['abi', 'creationBytecode']));
    const encodedConstructorArgs = extractEncodedConstructorArgs(creationData, recompiled.creationBytecode);
    lodash.assign(match, {encodedConstructorArgs});

    const { replaced } = this._addLibraryAddresses(recompiled.deployedBytecode, deployedBytecode);
    recompiled.deployedBytecode = replaced;
    if (deployedBytecode === recompiled.deployedBytecode) {
      lodash.assign(match, MATCH_STATUS.DEPLOYED_FULL);
      return match;
    }

    const trimmedDeployedBytecode = this._trimMetadata(deployedBytecode);
    const trimmedCompiledRuntimeBytecode = this._trimMetadata(recompiled.deployedBytecode);
    if (trimmedDeployedBytecode === trimmedCompiledRuntimeBytecode) {
      lodash.assign(match, MATCH_STATUS.DEPLOYED_PARTIAL);
      return match;
    }

    if (trimmedDeployedBytecode.length === trimmedCompiledRuntimeBytecode.length) {
      if (creationData.startsWith(recompiled.creationBytecode)) {
        lodash.assign(match, MATCH_STATUS.CREATION_FULL);
        return match;
      }

      const trimmedCompiledCreationBytecode = this._trimMetadata(recompiled.creationBytecode);
      if (creationData.startsWith(trimmedCompiledCreationBytecode)) {
        lodash.assign(match, MATCH_STATUS.CREATION_PARTIAL);
        return match;
      }
    }

    lodash.assign(match, MATCH_STATUS.NOT_MATCH);
    return match;
  }

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

    const result = await this.decompile({code: contract.deployedBytecode}).catch((e) => {
      throw new error.ContractDecompileError(e);
    });
    let exactMatch = runtimeCode === result.runtimeCode;
    // filter placeholder
    let runtimeBytecode = runtimeCode;
    let compileBytecode = result.runtimeCode;
    if(!exactMatch){
      const placeHolder = '0000000000000000000000000000000000000000000000000000000000000000';
      const offset = placeHolder.length;
      while(true){
        const index = compileBytecode.indexOf(placeHolder);
        if(index === -1) {
          break;
        }
        runtimeBytecode = `${runtimeBytecode.slice(0, index)}${runtimeBytecode.slice(index + offset, runtimeBytecode.length)}`;
        compileBytecode = `${compileBytecode.slice(0, index)}${compileBytecode.slice(index + offset, compileBytecode.length)}`;
      }
      exactMatch = (runtimeBytecode !== '') && (compileBytecode !== '') && (runtimeBytecode === compileBytecode);
    }
    // filter mata data hash, that is bzzr1 hash or ipfs hash
    if(!exactMatch){
      const mataDataHashPrefixArray = ['a265627a7a723158', 'a2646970667358'];
      mataDataHashPrefixArray.forEach(prefix => {
        if (!exactMatch && (runtimeBytecode.indexOf(prefix) !== -1)) {
          runtimeBytecode = runtimeBytecode.substr(0, runtimeBytecode.indexOf(prefix));
          compileBytecode = compileBytecode.substr(0, compileBytecode.indexOf(prefix));
          exactMatch = (runtimeBytecode !== '') && (compileBytecode !== '') && (runtimeBytecode === compileBytecode);
        }
      });
    }
    const similarity = tool.calculateSimilarity(type.hexToBuffer(runtimeCode), type.hexToBuffer(result.runtimeCode));
    const { abi, creationBytecode: bytecode } = contract;

    const verifyResult = { version, warnings, errors, exactMatch, similarity, abi, bytecode };
    logger.info({ src: `[${address}]verify`, contractName: `${name}`, verifyResult: `${JSON.stringify(verifyResult)}` });
    return verifyResult;
  }

  _addLibraryAddresses(template, real){
    const PLACEHOLDER_START = "__$";
    const PLACEHOLDER_LENGTH = 40;

    const libraryMap = {};

    let index = template.indexOf(PLACEHOLDER_START);
    for (; index !== -1; index = template.indexOf(PLACEHOLDER_START)) {
      const placeholder = template.slice(index, index + PLACEHOLDER_LENGTH);
      const address = real.slice(index, index + PLACEHOLDER_LENGTH);
      libraryMap[placeholder] = address;
      const regexCompatiblePlaceholder = placeholder.replace("__$", "__\\$").replace("$__", "\\$__");
      const regex = RegExp(regexCompatiblePlaceholder, "g");
      template = template.replace(regex, address);
    }

    return {
      replaced: template,
      libraryMap
    };
  }
}

module.exports = SolCompileService;
