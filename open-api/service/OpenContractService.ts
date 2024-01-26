import {getApiService} from "../ApiServer";
import {fixIconUrl} from "./OpenAccountService";
import {StatApp} from "../../stat/StatApp";
import {format} from "js-conflux-sdk";
import {
    checkEVMVersion,
    checkLibrary,
    checkPresent,
    mustBeAddressParamIfPresent
} from "../../stat/service/common/utils";
import {setBody} from "../router/middleware";
import {CONST} from "../../stat/service/common/constant"
import {toBase32} from "../../stat/service/tool/AddressTool";
import {ContractVerify} from "../../stat/model/ContractVerify";

const lodash = require('lodash');
const util = require('util');
const NodeCache = require( "node-cache" );

const MSG_IMPL_NO_MATCH = "A corresponding implementation contract was unfortunately not detected for the proxy address";
const MSG_IMPL_MATCH = "The proxy's (%s) implementation contract is found at %s and is successfully updated";

const addressInfoCache = new NodeCache()
const addressInfoTTL = 60 * 10; //
export async function polishContract(page) {
    const cachedMap = {}
    const contract = new Set<string>();
    function add(row, key) {
        const address = row[key];
        const cacheInfo = address ? addressInfoCache.get(address) : false;
        if (cacheInfo) {
            cachedMap[address] = cacheInfo;
            return;
        }
        // addresses in e space are mixed types.
        contract.add(address);
    }
    page?.list?.forEach(row=>{
        add(row, 'from')
        add(row, 'to')
        add(row, 'contract')
        if (StatApp.isEVM) {
            row.from = row.from ? format.hexAddress(row.from) : row.from;
            row.to = row.to ? format.hexAddress(row.to) : row.to;
            row.address = row.address ? format.hexAddress(row.address) : row.address;
            row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;
            row.contractAddress = row.contractAddress ? format.hexAddress(row.contractAddress) : '';
        }
    })
    const accountBasic = contract.size ? await getApiService().accountQuery.listPatchInfo([...contract])
        : {map: {}};
    page.addressInfo = accountBasic.map;
    Object.keys(page.addressInfo).forEach(k=>{
        const contract = page.addressInfo[k]?.contract || {}
        const token = page.addressInfo[k]?.token || {}

        if (token.tokenType) {
            token.tokenType = (!StatApp.isEVM) ? token.tokenType.replace('ERC', 'CRC') : token.tokenType;
        }
        fixIconUrl(token, 'address')

        addressInfoCache.set(k, page.addressInfo[k], addressInfoTTL);

        delete page.addressInfo[k]?.contract?.address;
        delete page.addressInfo[k]?.contract?.isVirtual;
        delete page.addressInfo[k]?.token?.address;
        (!contract.name) && delete page.addressInfo[k]?.contract?.name;
        (!token.website) && delete page.addressInfo[k]?.token?.website;
    })
    page.addressInfo = {...cachedMap, ...page.addressInfo};
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
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
    const {address} = ctx.request.query;
    checkPresent({address}, ['address']);

    const base32 = toBase32(address)
    const contract = await ContractVerify.findOne({where: {base32, verifyResult: true}, raw: true})
    if(!contract){
        setBody(ctx, undefined, 1, `contract ${address} not verified` );
        return;
    }

    setBody(ctx, contract.abi)
}

export async function getSourceCode(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'address');
    const {address} = ctx.request.query;
    checkPresent({address}, ['address']);

    const contract = await getApiService().contractQuery.queryVerify({address})
    if(!contract){
        setBody(ctx, undefined, 1, `contract ${address} not verified` );
        return;
    }

    let impl = ''
    if (contract.implementation) {
        impl = StatApp.isEVM ? format.hexAddress(contract.implementation) : contract.implementation;
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
        Implementation: impl,
        SwarmSource: "",
    });
    setBody(ctx, [contractItem])
}

export async function verifySourcecode(ctx) {
    let {
        contractaddress, sourceCode, codeformat, contractname, compilerversion, optimizationUsed, runs,
        constructorArguements, evmversion, licenseType,
        libraryname1, libraryaddress1, libraryname2, libraryaddress2, libraryname3, libraryaddress3,
        libraryname4, libraryaddress4, libraryname5, libraryaddress5, libraryname6, libraryaddress6,
        libraryname7, libraryaddress7, libraryname8, libraryaddress8, libraryname9, libraryaddress9,
        libraryname10, libraryaddress10
    } = ctx.request.body;
    const libMap = {
        library1: {name: libraryname1, address: libraryaddress1},
        library2: {name: libraryname2, address: libraryaddress2},
        library3: {name: libraryname3, address: libraryaddress3},
        library4: {name: libraryname4, address: libraryaddress4},
        library5: {name: libraryname5, address: libraryaddress5},
        library6: {name: libraryname6, address: libraryaddress6},
        library7: {name: libraryname7, address: libraryaddress7},
        library8: {name: libraryname8, address: libraryaddress8},
        library9: {name: libraryname9, address: libraryaddress9},
        library10: {name: libraryname10, address: libraryaddress10},
    };
    checkPresent({contractaddress, sourceCode, contractname, compilerversion/*, optimizationUsed, runs, licenseType*/},
        ['contractaddress', 'sourceCode', 'contractname', 'compilerversion'/*, 'optimizationUsed', 'runs', 'licenseType'*/]);
    const libraries = checkLibrary(libMap);
    const evmVersion = await checkEVMVersion(evmversion);

    if(codeformat === 'solidity-standard-json-input'){
        const sc = JSON.parse(sourceCode);
        optimizationUsed = sc.settings.optimizer.enabled;
        runs = sc.settings.optimizer.runs;
    }
    if(codeformat === 'solidity-single-file'){
        sourceCode = sourceCode?.replace(/\\n/g, '\n').replace(/\\\"/g, '"');
        sourceCode = sourceCode?.replace(/\\\n/g, '\\n');
    }
    optimizationUsed = optimizationUsed === undefined || optimizationUsed === null ? 0 : Number(optimizationUsed);
    runs = runs === undefined || runs === null ? 200 : Number(runs);
    licenseType = licenseType === undefined || licenseType === null ? 1 : Number(licenseType);

    if(optimizationUsed !== 0 && optimizationUsed !== 1){
        throw new Error(`Invalid parameter <optimizationUsed> with value [${optimizationUsed}], expect 0 or 1`);
    }
    if(optimizationUsed === 1 && (!Number.isInteger(runs) || runs < 0)){
        throw new Error(`Invalid parameter <runs> with value [${runs}], expect runs >= 0`);
    }
    if(licenseType< 1 || licenseType > 14){
        throw new Error(`Invalid parameter <licenseType> with value [${licenseType}], expect licenseType between 1 and 14`);
    }

    const options = {
        address: contractaddress,
        name: contractname,
        sourcecode: sourceCode,
        compilerType: codeformat,
        compilerVersion: compilerversion,
        optimizeFlag: !optimizationUsed ? false : true,
        optimizeRuns: runs,
        license: CONST.LICENSE[licenseType].code,
        constructorArgs: constructorArguements,
        libraries,
        evmVersion,
    };
    const submitResp = await getApiService().contractQuery.submitVerify(options);

    setBody(
        ctx,
        submitResp.error ? submitResp.error : submitResp.guid,
        submitResp.error ? 1 : 0,
        submitResp.error ? 'NOTOK' : 'OK'
    );
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

    setBody(ctx, 'Pass - Verified');
}

export async function verifyProxyContract(ctx) {
    const {address, expectedimplementation} = ctx.request.query;
    checkPresent({address}, ['address']);

    const options = {address, expectedImpl: expectedimplementation};
    const submitResp = await getApiService().contractQuery.submitVerifyProxy(options);

    setBody(ctx, submitResp.guid);
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
        setBody(ctx, util.format(MSG_IMPL_MATCH, proxy, impl));
    } catch (e){
        setBody(ctx, e.message, 1, 'NOTOK');
    }
}
