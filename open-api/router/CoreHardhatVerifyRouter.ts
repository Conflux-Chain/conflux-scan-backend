import * as Router from "koa-router";
import {getApiService} from "../ApiServer";
import {
    checkPresent,
    mustBeAddressParamIfPresent,
    splitFullyQualifiedName,
} from "../../stat/service/common/utils";
import {VerificationJob, VerifyInput} from "../../stat/service/ContractQuery";
import {StatApp, fmtAddr} from "../../stat/StatApp";
import {formatToBase32} from "../../stat/model/HexMap";

const lodash = require('lodash');
const util = require('util');

const MSG_IMPL_NO_MATCH = "A corresponding implementation contract was unfortunately not detected for the proxy address";
const MSG_IMPL_MATCH = "The proxy's (%s) implementation contract is found at %s and is successfully updated";
const DATA_NOT_VERIFIED = [{"SourceCode":"","ABI":"Contract source code not verified","ContractName":"","CompilerVersion":"","CompilerType":"","OptimizationUsed":"","Runs":"","ConstructorArguments":"","EVMVersion":"Default","Library":"","ContractFileName":"","LicenseType":"Unknown","Proxy":"0","Implementation":"","SwarmSource":"","SimilarMatch":""}]

function setHardhatBody(ctx, data: any, code = 0, message = 'OK') {
    const status = code === 0 ? '1' : '0';
    ctx.body = {status, message, result: data};
}

function parseGatewayParam(ctx) {
    const reqBody = ctx.request.body || {};
    const reqQuery = ctx.request.query || {};
    const module = `${reqQuery.module || reqBody.module || ''}`.toLowerCase();
    const action = `${reqQuery.action || reqBody.action || ''}`.toLowerCase();
    return {module, action};
}

async function getABI(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, false, 'address');
    const {address} = ctx.request.query;
    checkPresent({address}, ['address']);

    const contract = await getApiService().contractQuery.queryVerify(address, true)
    if(!contract){
        setHardhatBody(ctx, `Contract source code not verified`, 1, 'NOTOK' );
        return;
    }

    setHardhatBody(ctx, contract.abi)
}

async function getSourceCode(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, false, 'address');
    const {address} = ctx.request.query;
    checkPresent({address}, ['address']);

    const contract = await getApiService().contractQuery.queryVerify(address, true)
    if(!contract){
        setHardhatBody(ctx, DATA_NOT_VERIFIED, 0 );
        return;
    }

    let sourceCode = contract.sourceCode
    if(sourceCode && sourceCode.startsWith("{") && !sourceCode.startsWith("{{")) {
        sourceCode = `{${sourceCode}}`
    }

    const {contractPath, contractName} = splitFullyQualifiedName(contract.name);

    const contractItem = lodash.defaults({}, {
        SourceCode: sourceCode,
        ContractName: contractName,
        ABI: contract.abi,
        CompilerVersion: contract.version,
        EVMVersion: contract.evmVersion,
        OptimizationUsed: contract.optimization,
        Runs: contract?.runs?.toString(),
        Library: "",
        ContractFileName: contractPath,
        LicenseType: contract.license,
        ConstructorArguments: contract.constructorArgs,
        Proxy: contract.proxy ? '1' : '0',
        Implementation: contract.implementation || '',
        SwarmSource: "",
        SimilarMatch: StatApp.networkId === contract.similarMatchChainId ? fmtAddr(contract.similarMatchAddress, StatApp.networkId) : "",
    });

    setHardhatBody(ctx, [contractItem])
}

async function verifySourcecode(ctx) {
    const body = ctx.request.body || {};

    const libraries = (params: any, count: number = 10) => {
        const result: any = {};
        for (let i = 1; i <= count; i++) {
            result[`libraryName${i}`] = params[`libraryname${i}`];
            result[`libraryAddress${i}`] = params[`libraryaddress${i}`];
        }
        return result;
    }

    const input: VerifyInput = {
        contractAddress: body.contractaddress,
        sourceCode: body.sourceCode,
        codeFormat: body.codeformat,
        fullQualifiedName: body.contractname,
        compilerVersion: body.compilerversion,
        optimizationUsed: body.optimizationUsed,
        runs: body.runs,
        constructorArguments: body.constructorArguements || body.constructorArguments,
        evmVersion: body.evmversion,
        licenseType: body.licenseType,
        ...libraries(body),
    }

    const submit: any = await getApiService().contractQuery.verify(input)
    setHardhatBody(
        ctx,
        submit.message ? submit.message : submit.verificationId,
        submit.message ? 1 : 0,
        submit.message ? 'NOTOK' : 'OK'
    );
}

async function checkVerifyStatus(ctx) {
    const {guid} = ctx.request.query;
    checkPresent({guid}, ['guid']);

    const job: VerificationJob = await getApiService().contractQuery.checkVerification(guid)
    if(!job){
        setHardhatBody(ctx, undefined, 1, `verify with GUID ${guid} not found` );
        return;
    }

    if(!job.isJobCompleted) {
        setHardhatBody(ctx, 'Pending in queue', 1, 'NOTOK');
        return;
    }

    if(job?.error) {
        const e = job.error
        const data = e?.message ? `${e.customCode}:${e.message}` : `${e.customCode}`
        setHardhatBody(ctx, data, 1, 'NOTOK');
        return;
    }

    setHardhatBody(ctx, 'Pass - Verified');
}

async function verifyProxyContract(ctx) {
    const {address, expectedimplementation} = ctx.request.query;
    checkPresent({address}, ['address']);

    const options = {address, expectedImpl: expectedimplementation};
    const submitResp = await getApiService().contractQuery.submitVerifyProxy(options);

    setHardhatBody(ctx, submitResp.guid);
}

async function checkProxyVerification(ctx) {
    const {guid} = ctx.request.query;
    checkPresent({guid}, ['guid']);

    const verify = await getApiService().contractQuery.checkVerifyProxy({guid});
    if(!verify){
        setHardhatBody(ctx, undefined, 1, `verify with GUID ${guid} not found` );
        return;
    }
    if(!verify.proxy || (verify.expectedImpl && formatToBase32(verify.implementation) !== verify.expectedImpl)){
        setHardhatBody(ctx, MSG_IMPL_NO_MATCH, 1, 'NOTOK');
        return;
    }

    const proxy = verify.base32;
    const impl = verify.implementation;
    setHardhatBody(ctx, util.format(MSG_IMPL_MATCH, proxy, impl));
}

async function gateway(ctx) {
    const {module, action} = parseGatewayParam(ctx);
    if (module !== 'contract') {
        setHardhatBody(ctx, `unknown module:${module}`, 1, 'NOTOK');
        return;
    }

    switch (action) {
        case 'getabi':
            await getABI(ctx);
            break;
        case 'getsourcecode':
            await getSourceCode(ctx);
            break;
        case 'verifysourcecode':
            await verifySourcecode(ctx);
            break;
        case 'checkverifystatus':
            await checkVerifyStatus(ctx);
            break;
        case 'verifyproxycontract':
            await verifyProxyContract(ctx);
            break;
        case 'checkproxyverification':
            await checkProxyVerification(ctx);
            break;
        default:
            setHardhatBody(ctx, `unknown action:${action} of module:${module}`, 1, 'NOTOK');
            break;
    }
}

export function registerCoreHardhatVerifyRouter(router: Router) {
    router.get('/v1/evm/api', gateway);
    router.post('/v1/evm/api', gateway);
}
