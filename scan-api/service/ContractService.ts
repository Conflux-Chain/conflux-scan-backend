import {ScanApp, ScanCtx} from "./index";
import {VerificationJob, VerificationResult, VerifyByLinkInput, VerifyInput} from "../../stat/service/ContractQuery";
import {sleep} from "../../stat/service/tool/ProcessTool";
import {fmtAddr, StatApp} from "../../stat/StatApp";
import {CONST} from "../../stat/service/common/constant";
import {HomepageDashboard} from "../../stat/service/HomepageDashboard";

const lodash = require('lodash');
const {format} = require('js-conflux-sdk');

export class ContractService {
  app: ScanApp & any;

  constructor(app) {
    this.app = app;
  }

  async query({ address, fields }) {
    const {
      app: { service },
    } = this;

    const [account, sponsor, createInfo, announceInfo, verified, destroy] = await Promise.all([
      service.account.query({ address, fields }),
      service.conflux.getSponsorInfo(address),
      service.traceCreate.query(address),
      service.contractQuery.query(address),
      service.contractQuery.queryVerify(address, true),
      service.contractQuery.queryDestroyInfo(address),
    ]);

    account.sponsor = this.convertZeroAddressToNullStr(sponsor);

    let verify: any = {exactMatch: false}
    let proxy = {};
    let beacon = {};
    let implementation = {};
    if (verified) {
      verify = lodash.assign(verified, {
        exactMatch: true,
        optimization: parseInt(verified.optimization), // N/A|1|0|gas|codesize|none
        similarMatchNetworkId: verified.similarMatchChainId,
        crossSpace: Boolean(verified.similarMatchChainId && StatApp.networkId !== verified.similarMatchChainId),
      });
      delete verify.similarMatchChainId;
      proxy = lodash.pick(verified, ['proxy', 'proxyPattern']);
      beacon = {address: verified.beacon, verify: { exactMatch: verified.beaconVerified }};
      implementation = { address: verified.implementation, verify: { exactMatch: verified.implementationVerified } };
    } else {
      const resolved = await this.resolveEIP1167(address)
      if (resolved) {
        verify = lodash.defaults(resolved.verified, {exactMatch: true})
        proxy = resolved.proxy
        implementation = resolved.implementation
      }
    }

    const collateralForStorageInfo = await service.accountQuery.getStorageCollaterals(address);

    return lodash.defaults(account, createInfo, announceInfo, lodash.pick(verify, ['abi', 'sourceCode']),
        {verify, proxy, beacon, implementation, destroy, collateralForStorageInfo});
  }

  async listByAddresses({
    addressArray
  }) {
    const {
      app: {service}
    } = this as ScanCtx

    if (!addressArray?.length) {
      throw new this.app.error.ParameterError("addressArray is absent")
    }

    const list = await service.traceCreate.list(addressArray)
    if (!list?.length) {
      return []
    }

    const announcements = await service.contractQuery.list(list.map(item => item.address))
    const announcementMap = lodash.keyBy(announcements, 'address')
    const internalTxCountMap = HomepageDashboard.getData()?.internalContractInfo
    await Promise.all(list.map(async (c) => {
      const address = format.address(c.address, StatApp.networkId)
      c.name = announcementMap[address]?.name
      c.website = announcementMap[address]?.website
      c.admin = (await service.conflux.getAccount(address))?.admin
      if (lodash.includes(CONST.INTERNAL_CONTRACT, format.hexAddress(c.address))) {
        c.transactionCount = internalTxCountMap[format.hexAddress(c.address)] || 0
      }
    }))

    return list
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

  async verifySourcecode(params) {
    const {
      app: {service}
    } = this as ScanCtx;

    const libraries = (params: any, count: number = 10) => {
      const result: any = {};
      for (let i = 1; i <= count; i++) {
        result[`libraryName${i}`] = params[`libraryName${i}`];
        result[`libraryAddress${i}`] = params[`libraryAddress${i}`];
      }
      return result;
    }

    if (!params.codeFormat) {
      params.codeFormat = CONST.CONTRACT_CODE_FORMAT_INFO.SOLIDITY_SINGLE_FILE.code;
    }

    console.log(`request verifySourcecode ==\n`, {
      address: params.address,
      compiler: params.compiler,
      codeFormat: params.codeFormat,
      libraries,
    });

    const input: VerifyInput = {
      contractAddress: params.address,
      sourceCode: params.sourceCode,
      codeFormat: params.codeFormat,
      fullQualifiedName: params.name,
      compilerVersion: params.compiler,
      optimizationUsed: (Number.isInteger(params.optimizeRuns) && params.optimizeRuns >= 0) ? 1 : 0,
      runs: params.optimizeRuns,
      constructorArguments: params.constructorArgs,
      evmVersion: params.evmVersion,
      licenseType: params.license,
      ...libraries(params),
    }

    const submit: any = await service.contractQuery.verify(input)
    if(submit.message) {
      return {
        address: params.address,
        errors: [submit.message],
      };
    }

    return this.getVerificationResult(params.address, submit.verificationId);
  }

  public async verifyCrossSpace(params) {
    const {
      app: {service}
    } = this as ScanCtx;

    const key = params.includeAllOtherSpace ? `${StatApp.networkId}_ALL_OTHER_SPACE` : StatApp.networkId;
    const linkChainIds = CONST.CHAINS_CROSS_SPACE_VERIFY[key];

    console.log(`request verifyCrossSpace ==\n`, {
      address: params.address,
      includeAllOtherSpace: params.includeAllOtherSpace,
      linkChainIds,
    });

    const input: VerifyByLinkInput = {
      contractAddress: params.address,
      linkChainIds: linkChainIds,
    }

    const submit: any = await service.contractQuery.verifyByLink(input);
    if (submit.message) {
      return {
        address: params.address,
        errors: [submit.message],
      };
    }

    return this.getVerificationResult(params.address, submit.verificationId);
  }

  private async getVerificationResult(address: string, verificationId: string) {
    const {
      app: {service}
    } = this as ScanCtx;

    const result = await service.contractQuery.getVerificationResult(verificationId);

    if (result.error?.includes("contract_not_deployed")) {
      result.error = `contract_not_deployed`
    }
    if (result.error?.includes("no_similar_match_found")) {
      result.error = `no_similar_match_found`
    }

    return {
      address,
      errors: result.error ? [result.error] : undefined,
      exactMatch: result.match,
    };
  }

  async resolveEIP1167(address) {
    const {
      app: {cfx, service}
    } = this

    const code = await cfx.getCode(address)
    if (!CONST.REGEX_EIP1167_BYTECODE.test(code)) {
      return null
    }

    const impl = `0x${code.substr(22, 40)}`
    const verified = await service.contractQuery.queryVerify(impl, true)
    if (!verified) {
      return null
    }

    return {
      proxy: {proxy: 1, proxyPattern: "Minimal Proxy Contract"},
      implementation: {
        address: fmtAddr(impl, StatApp.networkId),
        verify: {
          exactMatch: true
        }
      },
      verified,
    }
  }
}

