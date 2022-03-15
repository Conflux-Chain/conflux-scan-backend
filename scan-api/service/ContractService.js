const lodash = require('lodash');
const { KV, KEY_ANNOUNCE_QUERY_RDB_SWITCH } = require('../../stat/dist/model/KV');
const { sign } = require('js-conflux-sdk');

class ContractService { // TODO: extends AccountService
  constructor(app) {
    this.app = app;
    this.LIST_CACHE_KEY = 'ContractService.contract/list/address';

    const {
      app: { type },
    } = this;

    this.zip = type({
      name: type.str,
      website: type.str,
      abi: type.gzip,
      sourceCode: type.gzip,
      optimizeRuns: type.uint.$after(String),
      icon: type.gzip,
    }, { pick: true });

    this.unzip = type({
      name: { key: type.base64ToString, value: type.base64ToString },
      website: { key: type.base64ToString, value: type.base64ToString },
      sourceCode: { key: type.base64ToString, value: type.unzipBase64 },
      optimizeRuns: { key: type.base64ToString, value: type.base64ToString.$after(Number) },
      abi: { key: type.base64ToString, value: type.unzipBase64 },
      icon: { key: type.base64ToString, value: type.unzipBase64 },
    });
  }

  async register({ address, ...rest }) {
    const {
      app: { error, dingTalk, ttlMap, service },
    } = this;

    const admin = await service.conflux.getAdmin(address);
    if (!admin) {
      throw new error.ParameterError(`contract "${address}" admin is "${admin}", register abort`);
    }

    const object = this.zip(rest);
    const array = [{ key: `contract/list/${address}`, value: address }];
    lodash.forEach(object, (value, field) => {
      array.push({ key: `contract/${address}/${field}`, value });
    });

    const result = await service.announce.send(array);

    ttlMap.delete(this.LIST_CACHE_KEY); // not strict drop list cache
    dingTalk.sendObject('Contract register', { address, ...lodash.mapValues(object, Boolean) });

    return result;
  }

  async deregister({ address }) {
    const {
      app: { service, ttlMap, dingTalk, type },
    } = this;

    const rdbSwitch = await KV.getSwitch(KEY_ANNOUNCE_QUERY_RDB_SWITCH);
    if (rdbSwitch) {
      const contract = await service.contractRdb.query({ address });
      if (contract && type.address(contract.base32) !== address) {
        return null;
      }
    }

    const key = `contract/list/${address}`;
    if (!rdbSwitch) {
      const { value } = await service.announce.query({ key });
      if (value !== address) {
        return null;
      }
    }

    const result = await service.announce.send([{ key, value: '' }]);
    ttlMap.delete(this.LIST_CACHE_KEY); // not strict drop list cache
    dingTalk.sendObject('Contract deregister', { address });
    return result;
  }

  async listVersion() {
    const {
      app: { syncSDK },
    } = this;

    try {
      return syncSDK.listVersion();
    } catch (e) {
      return { errors: [e.message] };
    }
  }

  async verify({ address, ...rest }) {
    const {
      app: { syncSDK, service, logger },
    } = this;

    const { name, sourceCode: sc, compiler, optimizeRuns, license, constructorArgs } = rest;
    const sourceCode = this._rmRedundantLicense(sc);
    const code = await service.conflux.getCode(address);
    if (code === undefined || code === '0x') {
      return { name, sourceCode, optimizeRuns, errors: [`invalid contract's code:${code}`] };
    }

    const verify = await service.contractRdb.queryVerify({ address });
    if (verify !== null) {
      return { name, sourceCode, optimizeRuns, errors: ['the contract already verified!'] };
    }

    try {
      const optimizeFlag = Number.isInteger(optimizeRuns) && optimizeRuns >= 0;
      const newVerify = await service.contractRdb.addVerify({ address, name, compiler: 'solidity',
        version: compiler, optimizeFlag, optimizeRuns, license });

      const result = await syncSDK.verify({ address, code, name, sourceCode, compiler, optimizeRuns, license });
      result.warnings = result.warnings.map((v) => v.formattedMessage || v.message);
      result.errors = result.errors.map((v) => v.formattedMessage || v.message);

      const creationDataHash = await this.getCreationDataHash({ address });
      const bytecodeHash = sign.keccak256(Buffer.from(result.bytecode)).toString('hex');
      const updateVerify = await service.contractRdb.updateVerify({ id: newVerify.id, address,
        version: result.version, sourceCode, abi: JSON.stringify(result.abi),
        verifyResult: result.exactMatch, similarity: result.similarity, creationDataHash, bytecodeHash});
      logger.error({ src: `[${address}]verify`, updateVerify: `${JSON.stringify(updateVerify)}` });
      return lodash.defaults({ name, sourceCode, optimizeRuns },
        lodash.pick(result, ['version', 'warnings', 'errors', 'exactMatch', 'similarity', 'abi']));

    } catch (e) {
      logger.error({ src: `[${address}]verify`, error: `${e.message}` });
      return { name, sourceCode, optimizeRuns, errors: [e.message] };
    }
  }

  _rmRedundantLicense(sourceCode) {
    let result = sourceCode.replace('SPDX-License-Identifier', '__license__');
    result = result.replace(/SPDX-License-Identifier/gi, 'SLI');
    result = result.replace('__license__', 'SPDX-License-Identifier');
    return result;
  }

  async listVerify({ skip, limit, reverse }) {
    const {
      app: { service, syncSDK, type, logger },
    } = this;
    const result = await service.contractRdb.listVerify({ skip, limit, reverse });

    try {
      const verifyList = result.list;
      for (const verify of verifyList) {
        // eslint-disable-next-line no-continue
        if (verify.constructorArgs) continue;

        // recompile
        const address = type.address(verify.address);
        const code = await service.conflux.getCode(address);
        // eslint-disable-next-line no-continue
        if (code === undefined || code === '0x') continue;
        const resp = await syncSDK.verify({
          address,
          code,
          name: verify.name,
          sourceCode: verify.sourceCode,
          compiler: verify.version,
          optimizeRuns: verify.runs === null ? undefined : verify.runs,
          license: verify.license,
        });

        // extract
        if (resp.exactMatch) {
          const creationData = await this.getCreationData({ address });
          const args = await this.extractConstructorArgs({ creationData, bytecode: resp.bytecode });
          if (args !== undefined) {
            await service.contractRdb.updateVerify({ id: verify.id, address, constructorArgs: args, creationData });
          }
          logger.info({ src: `[${address}]recompile`, match: `${resp.exactMatch}`, args: `${args}` });
        }
      }
    } catch (e) {
      logger.error({ src: 'recompile', error: `${e.message}` });
    }

    return result;
  }

  async extractConstructorArgs({ creationData, bytecode }) {
    return `0x${creationData.slice(bytecode.length)}`;
  }

  async getCreationData({ address }) {
    const {
      app: { service, logger },
    } = this;

    let creationData;
    try {
      const trace = await service.traceCreate.query(address);
      if (trace?.transactionHash !== undefined) {
        const transaction = await service.conflux.getTransactionByHash(trace.transactionHash);
        creationData = transaction.data;
      }

      creationData = creationData !== undefined ? creationData : '';
    } catch (e) {
      creationData = '';
      logger.error({ src: `[${address}]verify.getCreationData`, error: `${e.message}` });
    }

    return creationData;
  }

  async getCreationDataHash({ address }) {
    const {
      app: { service },
    } = this;

    const trace = await service.traceCreate.query(address);
    return trace?.creationDataHash;
  }

  // --------------------------------------------------------------------------
  async countAndList(options) {
    let result;
    if (options.addressArray !== undefined) {
      result = await this._countAndListByAddressArrayPlus(options);
    } else if (options.from !== undefined) {
      result = await this._countAndListBySyncPlus(options);
    } else {
      result = await this._countAndListByRegisterPlus(options);
    }
    return result;
  }

  // --------------------------------------------------------------------------
  async queryPlus({ address, fields }) { // fields: code、abi、sourceCode
    const {
      app: { service },
    } = this;

    const [account, sponsor, createInfo, announceInfo, verified] = await Promise.all([
      service.account.query({ address, fields }),
      service.conflux.getSponsorInfo(address),
      service.traceCreate.query(address),
      service.contractRdb.query({ address, fields }),
      service.contractRdb.queryVerify({ address }),
    ]);
    account.sponsor = this.convertZeroAddressToNullStr(sponsor);

    let verify = {};
    if (verified?.verifyResult) {
      verify = lodash.defaults({ exactMatch: true, optimization: verified.optimizeFlag, runs: verified.optimizeRuns },
        lodash.pick(verified, ['name', 'compiler', 'version', 'license', 'constructorArgs', 'creationData']));
      if (lodash.includes(fields, 'abi')) {
        announceInfo.abi = verified.abi;
      }
      if (lodash.includes(fields, 'sourceCode')) {
        announceInfo.sourceCode = verified.sourceCode;
      }
    }

    let proxy = {};
    let beacon = {};
    let implementation = {};
    if (verify.exactMatch) {
      proxy = lodash.pick(verified, ['proxy', 'proxyPattern']);
      beacon = {address: verified.beacon, verify: { exactMatch: verified.beaconVerified }};
      implementation = { address: verified.implementation, verify: { exactMatch: verified.implementationVerified } };
    }

    return lodash.defaults(account, createInfo, announceInfo, { verify }, { proxy }, {beacon}, { implementation });
  }

  async _countAndListByAddressArrayPlus({
    addressArray,
    from,
    minTimestamp,
    maxTimestamp,
    minEpochNumber,
    maxEpochNumber,
    skip = 0,
    limit = Infinity,
    fields,
  }) {
    const {
      app: { CONST, service },
    } = this;

    const traceResponse = await service.traceCreate.list({ addressArray, from, minTimestamp, maxTimestamp,
      minEpochNumber, maxEpochNumber, skip, limit });
    addressArray.forEach((item) => {
      if (lodash.includes(CONST.INTERNAL_CONTRACT, item)) {
        traceResponse.list.push({ address: this.app.type.simpleAddress(item) });
        traceResponse.total = traceResponse.list.length;
      }
    });
    if (!traceResponse.list.length) {
      return traceResponse;
    }

    const base32Array = traceResponse?.list.map((item) => item.address);
    const announceResponse = await service.contractRdb.list({ addressArray: base32Array, fields });
    const announceMap = lodash.keyBy(announceResponse.list, 'address');

    await Promise.all(traceResponse.list.map(async (createInfo) => {
      createInfo.name = announceMap[createInfo.address]?.name;
      createInfo.website = announceMap[createInfo.address]?.website;
      createInfo.abi = announceMap[createInfo.address]?.abi;
      createInfo.sourceCode = announceMap[createInfo.address]?.sourceCode;
      createInfo.admin = (await service.conflux.getAccount(createInfo.address)).admin;
      createInfo.transactionCount = await service.transaction.count({ accountAddress: createInfo.address });
    }));
    return traceResponse;
  }

  async _countAndListByRegisterPlus(options) {
    const {
      app: { service },
    } = this;

    const page = await service.contractRdb.listAddress();
    const addressArray = page?.list;

    return this._countAndListByAddressArrayPlus({ addressArray, ...options });
  }

  async _countAndListBySyncPlus(options) {
    return this._countAndListByAddressArrayPlus(options);
  }

  convertZeroAddressToNullStr(sponsor) {
    if (sponsor && sponsor.sponsorForCollateral
      && sponsor.sponsorForCollateral.indexOf(':AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') > 0) {
      sponsor.sponsorForCollateral = '';
    }
    if (sponsor && sponsor.sponsorForGas
      && sponsor.sponsorForGas.indexOf(':AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') > 0) {
      sponsor.sponsorForGas = '';
    }
    return sponsor;
  }
}

module.exports = ContractService;
