const path = require('path');
const lodash = require('lodash');
const semver = require('semver');
const solc = require('solc');
const cbor = require('cbor');
const {sign} = require('js-conflux-sdk');
const superagent = require('superagent');
require('superagent-proxy')(superagent);

const OPCODES = require('../common/lib/OPCODES.json');
const DOMAIN = 'https://solc-bin.ethereum.org/bin';
const {extractEncodedConstructorArgs} = require('../common/tool');
const MATCH_STATUS = {
  DEPLOYED_FULL: {matchCode: 201, matchDesc: 'deployed-full'},
  DEPLOYED_PARTIAL: {matchCode: 202, matchDesc: 'deployed-partial'},
  CREATION_FULL: {matchCode: 203, matchDesc: 'creation-full'},
  CREATION_PARTIAL: {matchCode: 204, matchDesc: 'creation-partial'},
  SIMILAR: {matchCode: 205, matchDesc: 'similar-match'},
  NOT_MATCH: {matchCode: 301, matchDesc: 'not-match'},
  CODE_NOT_FOUND: {matchCode: 401, matchDesc: 'code-not-found'},
  ERROR: {matchCode: 501, matchDesc: 'error'},
}

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

  async compile({ fileName, sourceCode, compilerType, compilerVersion, optimizeRuns, libraries, evmVersion }) {
    const {
      app: { tool, type, fileMap },
    } = this;
    const versionTable = await this.listVersion();
    compilerVersion = semver.maxSatisfying(Object.keys(versionTable), compilerVersion) || undefined;
    const solCompiler = await this.loadVersion(compilerVersion);
    const versionPartial = versionTable[compilerVersion].substr(8);
    const versionFullName = versionPartial.substr(0, versionPartial.length - 3);

    let input = {
      language: 'Solidity',
      sources: { [fileName]: { content: sourceCode } },
      settings: {
        optimizer: { enabled: Number.isInteger(optimizeRuns), runs: optimizeRuns },
        outputSelection: { '*': { '*': ['*'] } },
        libraries: Object.keys(libraries).length ? { [fileName]: libraries } : undefined,
        evmVersion: evmVersion ? evmVersion : undefined,
      },
    };
    if(compilerType === 'solidity-standard-json-input') {
      input = JSON.parse(sourceCode);
      if(!input.settings?.outputSelection) {
        input.settings.outputSelection = { '*': { '*': ['*'] } }
      }
    }
    const options = {
      import: (path) => {
        const contents = tool.readFile(path) || tool.readCommonContract(path) || tool.readNodeModules(path);
        return contents ? { contents } : { error: `can not found file "${path}"` };
      },
    };

    const inputJson = JSON.stringify(input);
    const outputJson = await fileMap.cache(`compile.${compilerVersion}.${type.toMD5(inputJson)}.json`,
      () => solCompiler.compile(inputJson, options),
    );

    const output = JSON.parse(outputJson);
    const contracts = lodash.mapValues(
      lodash.get(output.contracts, fileName, {}),
      ({ abi, evm }) => {
        const creationBytecode = `0x${evm.bytecode.object}`;
        const deployedBytecode = `0x${evm.deployedBytecode.object}`;
        return { abi, creationBytecode, deployedBytecode };
      },
    );
    const errors = lodash.filter(output.errors, (each) => each.severity === 'error');
    const warnings = lodash.filter(output.errors, (each) => each.severity !== 'error');

    return { compilerVersion: versionFullName, contracts, warnings, errors };
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
  async verifyPlus({ address, creationData, deployedBytecode, name, fileName, sourceCode, compilerType,
    compilerVersion, optimizeRuns, libraries, evmVersion }) {
    const {
      app: {error, type, },
    } = this;

    const match = {
      address,
      compilerVersion: null,
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
    const req = {fileName, sourceCode, compilerType, compilerVersion: type.solcVersion(metadata.solc) || compilerVersion,
      optimizeRuns, libraries, evmVersion};
    const resp = await this.compile(req).catch(e => {throw new error.CompilerError(e)});
    const {contracts, warnings, errors} = resp;
    lodash.assign(match, {compilerVersion: resp.compilerVersion, warnings, errors});
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

    const { replaced, libraryMap} = this._addLibraryAddresses(recompiled.deployedBytecode, deployedBytecode);
    this._checkLibrary(libraries, libraryMap);
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

  _checkLibrary(libraries, libraryMap) {
    if(!Object.keys(libraryMap).length) {
      return;
    }

    libraries = this._toMetadataLibraries(libraries);

    Object.keys(libraries).forEach(libName => {
      const libAddress = libraries[libName];
      const placeholder = `__$${sign.keccak256(libName.includes(':') ? libName : `undefined:${libName}`).toString('hex').substring(0, 34)}$__`
      const replacedAddress = libraryMap[placeholder];
      delete libraryMap[placeholder];

      if (!replacedAddress) {
        throw new Error(`library ${libName} name not match`);
      }
      if (libAddress.substring(2).toLowerCase() !== replacedAddress) {
        throw new Error(`library ${libName} address not match`);
      }
    });

    if(Object.keys(libraryMap).length) {
      throw new Error(`more libraries are needed`);
    }
  }

  _toMetadataLibraries(settingLibraries) {
    const libraries = {};
    lodash.forIn(settingLibraries, (lib, libKey) =>{
      if(typeof lib === 'object'){
        Object.keys(lib).forEach(libName => {
          libraries[`${libKey}:${libName}`] = lib[libName]
        })
      } else{
        libraries[libKey] = lib
      }
    });
    return libraries;
  }
}

module.exports = SolCompileService;
