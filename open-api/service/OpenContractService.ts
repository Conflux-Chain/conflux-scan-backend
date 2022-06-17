import {getApiService} from "../ApiServer";
import {fixIconUrl} from "./OpenAccountService";
import {StatApp} from "../../stat/StatApp";
import {format} from "js-conflux-sdk";
import {checkPresent, mustBeAddressParamIfPresent} from "../../stat/service/common/utils";
import {setBody} from "../router/middleware";

const lodash = require('lodash');
const util = require('util');
const CONST = require('../../stat/service/common/constant');

const MSG_IMPL_NO_MATCH = "A corresponding implementation contract was unfortunately not detected for the proxy address";
const MSG_IMPL_MATCH = "The proxy's (%s) implementation contract is found at %s and is successfully updated";

export async function polishContract(page, needAddressInfo) {
    if ('true' !== needAddressInfo) {
        // return // always true.
    }
    const contract = new Set<string>();
    function add(row, key) {
        const address = row[key];
        if (address && address.substr(address.indexOf(':')).startsWith(':ac')) {
            contract.add(address)
        }
    }
    page?.list?.forEach(row=>{
        add(row, 'from')
        add(row, 'to')
        add(row, 'contract')
        if (StatApp.isEVM) {
            row.from = row.from ? format.hexAddress(row.from) : row.from;
            row.to = row.to ? format.hexAddress(row.to) : row.to;
            row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;
            row.contractAddress = row.contractAddress ? format.hexAddress(row.contractAddress) : '';
        }
    })
    if (!contract.size) {
        return
    }
    const basicInfo = await getApiService().contractQuery.listBasic({addressArray:[...contract]})
    const map = basicInfo.map
    Object.keys(map).forEach(k=>{
        const contract = map[k].contract
        const token = map[k].token || {}
        if (contract?.verify?.result) {
            token.verifed = true
        }
        if (!token.name && contract?.name) {
            token.name = contract.name
        }
        if (token.tokenType) {
            token.tokenType = token.tokenType.replace('ERC', 'CRC')
        }
        fixIconUrl(token, 'address')
        map[k] = token
        delete token.address
        // delete map[k].contract
        // delete map[k].token
        // removeEmptyKey(map[k], 'contract')
        // removeEmptyKey(map[k], 'token')
        // removeEmptyKey(map, k)  // keep address, help debugging.
    })
    page.addressInfo = basicInfo.map
    if (StatApp.isEVM) {
        Object.keys(page.addressInfo).forEach(k => {
            page.addressInfo[format.hexAddress(k)] = page.addressInfo[k];
            delete page.addressInfo[k];
        });
    }
}
export function removeEmptyKey(obj, key) {
    if (isEmptyObj(obj[key])) {
        delete obj[key]
    }
}
export function isEmptyObj(obj) {
    return !obj || !Object.keys(obj).map(k=>obj[k]).some(v=> v!==undefined && v!==null)
}

export async function getABI(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'address');
    const {address} = ctx.request.query;
    checkPresent({address}, ['address']);

    const contract = await getApiService().contractQuery.queryVerify({address})
    if(!contract){
        setBody(ctx, undefined, 1, `contract ${address} not verified` );
        return;
    }

    const result = contract.abi;
    setBody(ctx, result)
}

export async function getSourceCode(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'address');
    const {address} = ctx.request.query;
    checkPresent({address}, ['address']);

    const contract = await getApiService().contractQuery.queryVerify({address})
    if(!contract){
        setBody(ctx, undefined, 1, `contract ${address} not verified` );
        return;
    }

    const contractItem = lodash.defaults({}, {
        SourceCode: contract.sourceCode,
        ABI: contract.abi,
        ContractName: contract.name,
        CompilerVersion: contract.version,
        OptimizationUsed: contract.optimizeFlag ? '1' : '0',
        Runs: contract.optimizeRuns,
        ConstructorArguments: contract.constructorArgs,
        EVMVersion: "Default",
        Library: "",
        LicenseType: contract.license,
        Proxy: contract.proxy ? '1' : '0',
        Implementation: contract.implementation,
        SwarmSource: "",
    });
    const result = [contractItem];
    setBody(ctx, result)
}

export async function verifySourcecode(ctx) {
    const {
        contractaddress, sourceCode, codeformat, contractname, compilerversion, optimizationUsed, runs,
        constructorArguements, evmversion, licenseType
    } = ctx.request.body;
    checkPresent({contractaddress, sourceCode, contractname, compilerversion, optimizationUsed, runs, licenseType},
        ['contractaddress', 'sourceCode', 'contractname', 'compilerversion', 'optimizationUsed', 'runs', 'licenseType']);

    if(optimizationUsed !== 0 && optimizationUsed !== 1){
        throw new Error(`Invalid parameter <optimizationUsed> with value [${optimizationUsed}], expect 0 or 1`);
    }
    if(optimizationUsed === 1 && (!Number.isInteger(runs) || runs < 0)){
        throw new Error(`Invalid parameter <runs> with value [${runs}], expect runs >= 0`);
    }

    const options = {
        address: contractaddress,
        name: contractname,
        sourcecode: sourceCode,
        compiler: compilerversion,
        optimizeFlag: !optimizationUsed ? false : true,
        optimizeRuns: runs,
        license: CONST.LICENSE[licenseType].code,
        constructorArgs: constructorArguements
    };
    const submitResp = await getApiService().contractQuery.submitVerify(options);

    setBody(ctx, submitResp.guid, submitResp.error ? 1 : 0, submitResp.error);
}

export async function checkVerifyStatus(ctx) {
    const {guid} = ctx.request.query;
    checkPresent({guid}, ['guid']);

    const verify = await getApiService().contractQuery.checkVerify({guid});
    if(!verify){
        setBody(ctx, undefined, 1, `verify with GUID ${guid} not found` );
        return;
    }
    if(!verify.verifyResult){
        setBody(ctx, undefined, 1, !verify.errors ? 'verify fail' : verify.errors);
        return;
    }

    const impl = !verify.implementation ? verify.implementation :
        (StatApp.isEVM ? format.hexAddress(verify.implementation) : verify.implementation);
    const result = [
        {
            SourceCode: verify.sourceCode,
            ABI: verify.abi,
            ContractName: verify.name,
            CompilerVersion: verify.version,
            OptimizationUsed: verify.optimizeFlag,
            Runs: verify.optimizeRuns,
            ConstructorArguments: verify.constructorArgs === '0x' ? '' : verify.constructorArgs,
            EVMVersion: "Default",
            Library: "",
            LicenseType: lodash.findKey(CONST.LICENSE, (v) => v.code === verify.license),
            Proxy: verify.proxy,
            Implementation: impl,
            SwarmSource:"",
        }
    ];
    setBody(ctx, result)
}

export async function verifyProxyContract(ctx) {
    const {address, expectedimplementation} = ctx.request.query;
    checkPresent({address}, ['address']);

    const options = {address, expectedImpl: expectedimplementation};
    const submitResp = await getApiService().contractQuery.submitVerifyProxy(options);

    const result = submitResp.guid
    setBody(ctx, result);
}

export async function checkProxyVerification(ctx) {
    const {guid} = ctx.request.query;
    checkPresent({guid}, ['guid']);

    try{
        const verify = await getApiService().contractQuery.checkVerifyProxy({guid});
        if(!verify){
            setBody(ctx, undefined, 1, `verify with GUID ${guid} not found` );
            return;
        }
        if(!verify.proxy || (verify.expectedImpl && verify.implementation !== verify.expectedImpl)){
            setBody(ctx, MSG_IMPL_NO_MATCH, 1, 'NOTOK');
            return;
        }

        const proxy = StatApp.isEVM ? format.hexAddress(verify.base32) : verify.base32;
        const impl = StatApp.isEVM ? format.hexAddress(verify.implementation) : verify.implementation;
        const result = util.format(MSG_IMPL_MATCH, proxy, impl);
        setBody(ctx, result);
    } catch (e){
        setBody(ctx, e.message, 1, 'NOTOK');
    }
}
