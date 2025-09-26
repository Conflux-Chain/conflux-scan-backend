import {ScanApp, ScanCtx} from "./index";
import {VerificationJob, VerifyInput} from "../../stat/service/ContractQuery";
import {sleep} from "../../stat/service/tool/ProcessTool";
import {fmtAddr, StatApp} from "../../stat/StatApp";
import {CONST} from "../../stat/service/common/constant";

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
      verify = lodash.defaults(verified, {exactMatch: true})
      verify.optimization = parseInt(verify.optimization) // N/A|1|0|gas|codesize|none
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

    const collateralForStorageInfo = await service.accountQuery.getCollateralForStorageInfo(address);

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
    const internalTxCountMap = service.homeDashboard.getData()?.internalContractInfo
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

    console.log(`request verifySourcecode ==\n`, {
      address: params.address,
      compiler: params.compiler,
      codeFormat: params.codeFormat,
    })
    if(!params.codeFormat) {
      params.codeFormat = CONST.CONTRACT_CODE_FORMAT_INFO.SOLIDITY_SINGLE_FILE.code
    }
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
      libraryName1: params.libraryName1, libraryAddress1: params.libraryAddress1,
      libraryName2: params.libraryName2, libraryAddress2: params.libraryAddress2,
      libraryName3: params.libraryName3, libraryAddress3: params.libraryAddress3,
      libraryName4: params.libraryName4, libraryAddress4: params.libraryAddress4,
      libraryName5: params.libraryName5, libraryAddress5: params.libraryAddress5,
      libraryName6: params.libraryName6, libraryAddress6: params.libraryAddress6,
      libraryName7: params.libraryName7, libraryAddress7: params.libraryAddress7,
      libraryName8: params.libraryName8, libraryAddress8: params.libraryAddress8,
      libraryName9: params.libraryName9, libraryAddress9: params.libraryAddress9,
      libraryName10: params.libraryName10, libraryAddress10: params.libraryAddress10,
    }

    console.log(`input.codeFormat`, input.codeFormat)
    const submit: any = await service.contractQuery.verify(input)
    if(submit.message) {
      return {
        address: params.address,
        errors: [submit.message]
      }
    }

    for (let i = 0; i < 10; i++) {
      const job: VerificationJob = await service.contractQuery.checkVerification(submit.verificationId)
      if(!job.isJobCompleted) {
        await sleep(3000)
        continue
      }

      if(job?.error) {
        const e = job.error
        return {
          address: params.address,
          errors: [e?.message ? `${e.customCode}:${e.message}` : `${e.customCode}`]
        }
      }

      return {
        address: params.address,
        exactMatch: !!job.contract.match,
      }
    }

    return {
      address: params.address,
      errors: ['Pending in queue, please check contract detail page later!']
    }
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

