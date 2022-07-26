const lodash = require('lodash');
// const { KV, KEY_ANNOUNCE_QUERY_RDB_SWITCH } = require('../../stat/dist/model/KV');
const { ContractVerify } = require('../../stat/dist/model/ContractVerify');
const { format, sign } = require('js-conflux-sdk');

class ContractService { // TODO: extends AccountService
  constructor(app) {
    this.app = app;
    this.LIST_CACHE_KEY = 'ContractService.contract/list/address';
    this.EXACT_MATCH = { matchCode: 1, matchDesc: 'Exact Match'};
    this.SIMILAR_MATCH = { matchCode: 2, matchDesc: 'Similar Match'};

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

    // const rdbSwitch = await KV.getSwitch(KEY_ANNOUNCE_QUERY_RDB_SWITCH);
    // if (rdbSwitch) {
      const contract = await service.contractRdb.query({ address });
      if (contract && type.address(contract.base32) !== address) {
        return null;
      }
    // }

    const key = `contract/list/${address}`;
/*    if (!rdbSwitch) {
      const { value } = await service.announce.query({ key });
      if (value !== address) {
        return null;
      }
    }*/

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
      app: { CONST, error, syncSDK, service, logger},
    } = this;

    let { name, sourceCode, compilerType, compiler, optimizeRuns, license, constructorArgs } = rest;
    sourceCode = this._rmRedundantLicense(sourceCode);
    const response = { name, sourceCode, optimizeRuns };

    const code = await service.conflux.getCode(address);
    if (code === undefined || code === '0x') {
      return lodash.assign(response, { errors: [`invalid contract's code:${code}`] });
    }
    const codeHash = sign.keccak256(Buffer.from(code)).toString('hex');

    const verify = await service.contractRdb.queryVerify({ address });
    if (verify !== null) {
      return lodash.assign(response, { errors: ['the contract already verified!'] });
    }

    try {
      compilerType = compilerType === undefined || compilerType === null ? CONST.COMPILER_TYPE.SINGLE_FILE : compilerType;
      if (!lodash.includes(Object.values(CONST.COMPILER_TYPE), compilerType)) {
        throw new error.QueryCreationDataError(e);
      }
      const optimizeFlag = Number.isInteger(optimizeRuns) && optimizeRuns >= 0;
      const record = await service.contractRdb.addVerify({ address, sourceCode, name, compiler: compilerType,
        version: compiler, optimizeFlag, optimizeRuns, license, codeHash });

      const creationData = await this.getCreationData({ address }).catch(e => {throw new error.QueryCreationDataError(e)});
      const result = await syncSDK.verifyPlus({address, creationData, deployedBytecode: code, name, sourceCode,
        compilerType, compilerVersion: compiler, optimizeRuns});
      result.verifyResult = this._getVerifyResult(result.matchCode);
      result.warnings = result.warnings.map((v) => v.formattedMessage || v.message);
      result.errors = result.errors.map((v) => v.formattedMessage || v.message);

      const updateRecord = {id: record.id, address, abi: JSON.stringify(result.abi),
        constructorArgs: result.encodedConstructorArgs, version: result.compilerVersion};
      lodash.assign(updateRecord, lodash.pick(result, ['verifyResult', 'matchCode', 'matchDesc' ]));
      const updateVerify = await service.contractRdb.updateVerify(updateRecord);

      logger.error({ src: `[${address}]verify`, updateVerify: `${JSON.stringify(updateVerify)}` });
      return lodash.assign(response, lodash.pick(result, ['version', 'warnings', 'errors', 'abi']),
          {exactMatch: result.verifyResult});

    } catch (e) {
      logger.error({ src: `[${address}]verify`, error: `${e.message}` });
      return lodash.assign(response, { errors: [e.message] });
    }
  }

  _rmRedundantLicense(sourceCode) {
    let result = sourceCode.replace('SPDX-License-Identifier', '__license__');
    result = result.replace(/SPDX-License-Identifier/gi, 'SLI');
    result = result.replace('__license__', 'SPDX-License-Identifier');
    return result;
  }

  async listVerify({ addressArray, skip, limit, reverse }) {
    const {
      app: {CONST, error, service, syncSDK, type, logger},
    } = this;
    const result = await service.contractRdb.listVerify({ addressArray, skip, limit, reverse });

    let tmpAddress;
    let tmpCntr = 0;
    try {
      const verifyList = result.list;
      for (const verify of verifyList) {

        const address = type.address(verify.address);
        tmpAddress = address;
        tmpCntr = tmpCntr + 1;
        if (lodash.includes(CONST.INTERNAL_CONTRACT, address)) {
          await ContractVerify.update(CONST.MATCH_STATUS.INTERNAL_CONTRACT, {where: {id: verify.id}});
          // console.log(`[${address}][cntr=${tmpCntr}]recompile-1------internal contract---`);
          continue;
        }

        const creationData = await this.getCreationData({ address }).catch(e => {throw new error.QueryCreationDataError(e)});
        const code = await service.conflux.getCode(address);
        // console.log(`[${address}][cntr=${tmpCntr}]recompile-1------creationData.len:${creationData?.length || 0}---`);

        const resp = await syncSDK.verifyPlus({
          address,
          creationData,
          deployedBytecode: code,
          name: verify.name,
          sourceCode: verify.sourceCode,
          compiler: verify.version,
          optimizeRuns: verify.runs === null ? undefined : verify.runs,
        });
        const warnings = resp.warnings.map((v) => v.formattedMessage || v.message);
        const errors = resp.errors.map((v) => v.formattedMessage || v.message);
        // console.log(`[${address}][cntr=${tmpCntr}]recompile-2------creationBytecode.len:${resp.creationBytecode?.length || 0},warnings:${JSON.stringify(warnings)},errors:${JSON.stringify(errors)}---`);

        const verifyRecord = lodash.assign({constructorArgs: resp.encodedConstructorArgs},
            lodash.pick(resp, ['matchCode', 'matchDesc']));
        await ContractVerify.update(verifyRecord, {where: {id: verify.id}});
        const verifyResult = this._getVerifyResult(resp.matchCode);
        // console.log(`[${address}][cntr=${tmpCntr}]recompile-3-----matchCode:${resp.matchCode},matchDesc:${resp.matchDesc},verifyResult:${verifyResult},args.len:${verifyRecord?.constructorArgs?.length || 0}---`);
      }

    } catch (e) {
      // console.error(`[${tmpAddress}][cntr=${tmpCntr}]recompile-4--------`, e);
      logger.error({ src: 'recompile', error: `${e.message}` });
    }
    return result;
  }

  async getCreationData({ address }) {
    const {
      app: { confluxSDK, CONST, service, type },
    } = this;

    const hash = lodash.findKey(CONST.GENESIS_TX_TO_CONTRACT, (v) => format.hexAddress(v) === address);
    if(hash){
      const transaction = await confluxSDK.getTransactionByHash(hash);
      return transaction.data;
    }

    const trace = await service.traceCreate.query(address);
    const transaction = await confluxSDK.getTransactionByHash(trace.transactionHash);
    const transactionTraceArray = await confluxSDK.traceTransaction(transaction.hash);
    const traceArray = await confluxSDK.matchTrace(transactionTraceArray, transaction);
    const creatTraceArray = traceArray.filter(trace => (trace.type === CONST.TRACE_TYPE.CREATE &&
        trace.transactionHash === transaction.hash &&
        type.address(trace.action.to) === type.address(address)));
    const traceCreate = creatTraceArray[0];

    return traceCreate.action.init;
  }

  _getVerifyResult(matchCode) {
    const {
      app: {
        CONST: {MATCH_STATUS},
      },
    } = this;

    return matchCode === MATCH_STATUS.INTERNAL_CONTRACT.matchCode ||
        matchCode === MATCH_STATUS.DEPLOYED_FULL.matchCode ||
        matchCode === MATCH_STATUS.DEPLOYED_PARTIAL.matchCode ||
        matchCode === MATCH_STATUS.CREATION_FULL.matchCode ||
        matchCode === MATCH_STATUS.CREATION_PARTIAL.matchCode ||
        matchCode === MATCH_STATUS.SIMILAR.matchCode;
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

    const [account, sponsor, createInfo, announceInfo, verified, destroy] = await Promise.all([
      service.account.query({ address, fields }),
      service.conflux.getSponsorInfo(address),
      service.traceCreate.query(address),
      service.contractRdb.query({ address, fields }),
      service.contractRdb.queryVerify({ address }),
      service.contractRdb.queryDestroyInfo({ address }),
    ]);
    account.sponsor = this.convertZeroAddressToNullStr(sponsor);

    let verify = {};
    if (verified?.verifyResult) {
      verify = lodash.defaults({ exactMatch: true, optimization: verified.optimizeFlag, runs: verified.optimizeRuns },
        lodash.pick(verified, ['name', 'compiler', 'version', 'license', 'constructorArgs', 'matchCode', 'similarMatch']));
      verify = lodash.assign(verify, this.convertMatchInfo(verify.matchCode));
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

    return lodash.defaults(account, createInfo, announceInfo, { verify }, { proxy }, {beacon}, { implementation },
        { destroy });
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

  convertMatchInfo(matchStatus) {
    const {
      app: { CONST },
    } = this;

    return matchStatus === CONST.MATCH_STATUS.SIMILAR.matchCode ? this.SIMILAR_MATCH : this.EXACT_MATCH;
  }
}

module.exports = ContractService;
