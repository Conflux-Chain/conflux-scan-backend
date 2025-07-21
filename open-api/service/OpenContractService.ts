import {getApiService} from "../ApiServer";
import {fixIconUrl} from "./OpenAccountService";
import {StatApp} from "../../stat/StatApp";
import {format} from "js-conflux-sdk";
import {
    checkEVMVersion,
    checkLibrary,
    checkPresent,
    mustBeAddressArrayParamIfPresent,
    mustBeAddressParamIfPresent
} from "../../stat/service/common/utils";
import {setBody} from "../router/middleware";
import {CONST} from "../../stat/service/common/constant"
import {toBase32} from "../../stat/service/tool/AddressTool";
import {FullTransaction} from "../../stat/model/FullBlock";
import {QueryTypes} from "sequelize";
import {ContractVerify} from "../../stat/model/ContractVerify";
import {CompilationTarget, VerificationJob, VerifyFromJsonInput, VerifyInput} from "../../stat/service/ContractQuery";
import {SolidityJsonInput, VyperJsonInput} from "@ethereum-sourcify/compilers-types";
import {Libraries, SoliditySettings, Sources} from "@ethereum-sourcify/compilers-types/build/main/SolidityTypes";

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

    const contract = await getApiService().contractQuery.queryVerify(address, true)
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

    const contract = await getApiService().contractQuery.queryVerify(address, true)
    if(!contract){
        setBody(ctx, undefined, 1, `contract ${address} not verified` );
        return;
    }

    let impl = ''
    if (contract.implementation) {
        impl = StatApp.isEVM ? format.hexAddress(contract.implementation) : contract.implementation;
    }

    let sourceCode = contract.sourceCode
    if(sourceCode && sourceCode.startsWith("{") && !sourceCode.startsWith("{{")) {
        sourceCode = `{${sourceCode}}`
    }

    const contractItem = lodash.defaults({}, {
        SourceCode: sourceCode,
        ABI: contract.abi,
        ContractName: contract.name,
        CompilerVersion: contract.version,
        OptimizationUsed: contract.optimization ? '1' : '0',
        Runs: contract.runs ? `${contract.runs}` : contract.runs,
        ConstructorArguments: contract.constructorArgs,
        EVMVersion: contract.evmVersion ? contract.evmVersion : "Default",
        Library: "",
        LicenseType: contract.license,
        Proxy: contract.proxy ? '1' : '0',
        Implementation: impl,
        SwarmSource: "",
    });
    setBody(ctx, [contractItem])
}

const MAX_CONTRACTS = 5;
export async function getContractCreation(ctx) {
    mustBeAddressArrayParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contractaddresses');
    const { contractaddresses } = ctx.request.query;
    checkPresent({contractaddresses}, ['contractaddresses']);
    if(contractaddresses.length > MAX_CONTRACTS){
        setBody(ctx, null, 1, `Contract addresses up to ${MAX_CONTRACTS} at a time`);
        return
    }

    const contractCreations = []
    for (let addr of contractaddresses) {
        const trace: any = await getApiService().traceCreateQuery.query(format.hexAddress(addr));
        if(trace.msg) {
            console.log(`No trace found for contract ${addr}`)
            continue
        }

        const txHash = trace.transactionHash
        const contractCreated = await FullTransaction.sequelize.query(`
            select h.hex as address from full_tx t  
            join hex40 h on t.contractCreatedId = h.id 
            where t.hash = ?
        `, {
            type: QueryTypes.SELECT,
            replacements: [txHash]
        }).then((list: any[]) => (list?.length ? `0x${list[0].address}` : null))

        let creationBytecode: string
        if(contractCreated && format.hexAddress(contractCreated) === format.hexAddress(addr)) {
            const transaction = await getApiService().cfx.getTransactionByHash(txHash)
            creationBytecode = transaction.data
        } else {
            const traces: any[] = await getApiService().cfx.traceTransaction(txHash);
            const stack = []
            for (const trace of traces) {
                if(trace.type === 'create') {
                    stack.push(trace)
                }
                if(trace.type === 'create_result') {
                    if(format.hexAddress(trace.action.addr) === format.hexAddress(addr)) {
                        const createTrace = stack.pop()
                        creationBytecode = createTrace.action.init
                        break
                    } else{
                        stack.pop()
                    }
                }
            }
        }

        const contractAddress = StatApp.isEVM ? format.hexAddress(addr) : format.address(addr, StatApp.networkId)
        const contractCreator = StatApp.isEVM ? trace.from : format.address(trace.from, StatApp.networkId)
        const contractFactory = StatApp.isEVM ? trace.contractFactory :
            (trace.contractFactory ? format.address(trace.contractFactory, StatApp.networkId) : trace.contractFactory)
        contractCreations.push({
            contractAddress,
            contractCreator,
            txHash,
            blockNumber: trace.epochNumber,
            timestamp: trace.timestamp,
            contractFactory,
            creationBytecode,
        })
    }

    setBody(ctx, contractCreations)
}

export async function verifySourcecode(ctx) {
    const body = ctx.request.body;
    const input: VerifyInput = {
        contractAddress: body.contractaddress,
        sourceCode: body.sourceCode,
        codeFormat: body.codeformat,
        fullQualifiedName: body.contractname,
        compilerVersion: body.compilerversion,
        optimizationUsed: body.optimizationUsed,
        runs: body.runs,
        constructorArguments: body.constructorArguements,
        evmVersion: body.evmversion,
        licenseType: body.licenseType,
        libraryName1: body.libraryname1, libraryAddress1: body.libraryaddress1,
        libraryName2: body.libraryname2, libraryAddress2: body.libraryaddress2,
        libraryName3: body.libraryname3, libraryAddress3: body.libraryaddress3,
        libraryName4: body.libraryname4, libraryAddress4: body.libraryaddress4,
        libraryName5: body.libraryname5, libraryAddress5: body.libraryaddress5,
        libraryName6: body.libraryname6, libraryAddress6: body.libraryaddress6,
        libraryName7: body.libraryname7, libraryAddress7: body.libraryaddress7,
        libraryName8: body.libraryname8, libraryAddress8: body.libraryaddress8,
        libraryName9: body.libraryname9, libraryAddress9: body.libraryaddress9,
        libraryName10: body.libraryname10, libraryAddress10: body.libraryaddress10,
    }
    const submit: any = await getApiService().contractQuery.verify(input)

    setBody(
        ctx,
        submit.error ? submit.error : submit.verificationId,
        submit.error ? 1 : 0,
        submit.error ? 'NOTOK' : 'OK'
    );
}

export async function checkVerifyStatus(ctx) {
    const {guid} = ctx.request.query;
    checkPresent({guid}, ['guid']);

    const job: VerificationJob = await getApiService().contractQuery.checkVerification(guid)
    if(!job){
        setBody(ctx, undefined, 1, `verify with GUID ${guid} not found` );
        return;
    }

    if(!job.isJobCompleted) {
        setBody(ctx, 'Pending in queue', 1, 'NOTOK');
        return;
    }

    if(job?.error) {
        const e = job.error
        const data = e?.message ? `${e.customCode}:${e.message}` : `${e.customCode}`
        setBody(ctx, data, 1, 'NOTOK');
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
        if(!verify.proxy || (verify.expectedImpl && toBase32(verify.implementation) !== verify.expectedImpl)){
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
