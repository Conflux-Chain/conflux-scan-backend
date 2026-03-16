import {Conflux, format as sdk_format, sign} from "js-conflux-sdk";
import {Errors} from "./LogicError";
import {ScanHttpProvider} from "./ScanHttpProvider";
import {ConfluxOption} from "../../config/StatConfig";
import {networkInterfaces} from 'os';
import {ethers} from "ethers";
import {ConsortiumConflux} from "./ConsortiumConflux";
import {useFastFormat} from "./fastFormatter";
import {CONST} from "./constant";
import {CallParams} from "../AccountQuery";

const lodash = require('lodash');
const {isValidCfxAddress, decodeCfxAddress} = require('js-conflux-sdk/src/util/address');

export function pageParam(obj: object, skipKey: string, limitKey: string, defaultLimit: number) {
    const param = {
        skip: intParam(obj, skipKey, 0),
        limit: intParam(obj, limitKey, defaultLimit)
    };
    if (param.skip > 10000) {
        throw new Errors.ParameterError('Parameter <skip> exceeds 10000')
    }
    if (param.limit > 100) {
        throw new Errors.ParameterError('Parameter <limit> exceeds 100')
    }
    return param
}

export function getPagination(requestObj: object, {defaultSkip, maxSkip, defaultLimit, maxLimit}:
    {defaultSkip?: number, maxSkip?: number, defaultLimit?: number, maxLimit?: number}
    = {defaultSkip: 0, maxSkip: 10000, defaultLimit: 10, maxLimit: 10000}
) {
    const param = {
        skip: intParam(requestObj, 'skip', defaultSkip),
        limit: intParam(requestObj, 'limit', defaultLimit)
    };
    if (param.skip > maxSkip) {
        throw new Errors.ParameterError(`Parameter <skip> exceeds ${maxSkip}`)
    }
    if (param.limit > maxLimit) {
        throw new Errors.ParameterError(`Parameter <limit> exceeds ${maxLimit}`)
    }
    return param
}

export function getPaginationESpace(requestObj: object, {defaultPage, maxPage, defaultOffset, maxOffset}:
    {defaultPage: number, maxPage: number, defaultOffset: number, maxOffset: number}
    = {defaultPage: 1, maxPage: 10000, defaultOffset: 100, maxOffset: 100}
) {
    const param = {
        page: intParam(requestObj, 'page', defaultPage),
        offset: intParam(requestObj, 'offset', defaultOffset)
    };
    if (param.page < 1) {
        throw new Errors.ParameterError(`Parameter <page> starts at 1`)
    }
    if (param.page > maxPage) {
        throw new Errors.ParameterError(`Parameter <page> exceeds ${maxPage}`)
    }
    if (param.offset < 1) {
        throw new Errors.ParameterError(`Parameter <offset>'s minimum value is 1`)
    }
    if (param.offset > maxOffset) {
        throw new Errors.ParameterError(`Parameter <offset> exceeds ${maxOffset}`)
    }
    return param
}

export function patchFormat() {
    const fun = sdk_format.address;
    function safeAddress(str, networkId, verbose) {
        try {
            return fun(str, networkId, verbose)
        } catch (e) {
            // console.log(`format address fail for `,str, networkId, verbose)
            return str;
        }
    }
    // @ts-ignore  sdk_format.address
    sdk_format["address"] = safeAddress;
}

export function noVerboseAddr(v) {
    const obj = decodeCfxAddress(v)
    return sdk_format.address(obj.hexAddress, obj.netId)
}

// skip exceeds 10_000;
export function skipLimitAny(obj) {
    return {
        skip: intParam(obj, 'skip', 0),
        limit: intParam(obj, 'limit', 10)
    };

}

export function skipLimit(obj) {
    return pageParam(obj, 'skip', 'limit', 10)
}

export class InvalidParamError extends Error{}

export function intParam(obj: object, key: string, defaultV: number) {
    const v = obj[key]
    if (v === undefined || v === null) {
        return defaultV
    }
    if (!/^[0-9]+$/.test(v)) {
        throw new Errors.ParameterError(`Invalid parameter [${key}] with value[${v}]`)
    }
    let number: number;
    try {
        number = parseInt(v);
    } catch (e) {
        return defaultV
    }
    if (isNaN(number)) {
        throw new Errors.ParameterError(`Invalid parameter [${key}] with value [${v}]`)
    }
    return number;
}

export function buildMinMaxTimestampFilter(ctx: any) {
    const {minTimestamp, maxTimestamp} = ctx?.request?.query || {};
    return [minTimestamp, maxTimestamp].map(str=>{
        return str ? new Date( str * 1000) : null;
    }).map(dt=>{
        return dt ? dt.toISOString().split('T')[0] : ""
    }).map((str, idx)=>{
        return str ? ` and day ${idx == 0 ? '>=' : '<='} '${str}' ` : '';
    }).join(' ');
}

export function mustBeIntParamIfPresent(obj, ...keys:string[]) {
    for (const k of keys) {
        const v = obj[k];
        if (v === undefined || v === null) {
            continue
        }
        if (!/^[0-9]+$/.test(v)) {
            throw new Errors.ParameterError(`Invalid parameter [${k}] with value [${v}].`)
        }
        obj[k] = k === 'tokenId' ? BigInt(v) : parseInt(v);
        if (/imestamp/.test(k)) {
            let dt = new Date(v * 1000)
            const tm = dt.getTime();
            if (isNaN(tm) || dt.getFullYear() > 3000) {
                throw new Errors.ParameterError(`Invalid timestamp parameter (in second format) [${k}] with value [${v}].`)
            }
        }
    }
}

export function mustBeEnumParamIfPresent(obj, key: string, options:string[]) {
    const v = obj[key]
    if (v === undefined || v === null) {
        return
    }
    const has = options.includes(v)
    if (has) {
        return
    }
    throw new Errors.ParameterError(`Invalid parameter [${key}] with value [${v}]. Should be one of [${options.join(',')}]`)
}

export function mustBeEnumParamArrayIfPresent(obj, key: string, options:string[]) {
    let v = obj[key]
    if (v === undefined || v === null) {
        return
    }

    const paramArray = [];
    if (lodash.isArray(v)) {
        v.map(e => e.trim()).filter(Boolean).forEach(e => paramArray.push(e));
    } else {
        v = v?.trim()
        const splitV = v.split(',')
        if (lodash.isArray(splitV)) {
            splitV.map(e => e.trim()).filter(Boolean).forEach(e => paramArray.push(e));
        } else {
            paramArray.push(v);
        }
    }

    paramArray.forEach(e => mustBeEnumParamIfPresent({[key]: e}, key, options))
    obj[key] = paramArray
}

export function mustBeAddressParamIfPresent(obj, netId, isEVM, ...keys:string[]) {
    for(const k of keys) {
        const v = obj[k];
        if (v === undefined || v === null) {
            continue;
        }
        if (/0x[0-9a-fA-F]{40}/.test(v)) {
            continue; // hex 40
        }
        if (!isValidCfxAddress(v)) {
            throw new Errors.ParameterError(`Invalid address parameter [${k}] with value [${v}].`);
        }
        const addr = decodeCfxAddress(v)
        if (addr.netId !== netId) {
            throw new Errors.ParameterError(`Invalid address parameter [${k}] with value [${v}], prefix is invalid.`);
        }
        if (/contract/.test(k) && addr.type !== 'contract' && !isEVM) {
            throw new Errors.ParameterError(`Invalid contract parameter [${k}] with value [${v}], type [${addr.type}], it's not a contract address.`);
        }
    }
}

export function mustBeAddressArrayParamIfPresent(obj, netId, isEVM, ...keys:string[]) {
    for(const k of keys) {
        let vArray = obj[k];
        if (vArray === undefined || vArray === null) {
            continue;
        }

        if (!lodash.isArray(vArray)) {
            vArray = vArray.split(',');
        }

        for (const v of vArray) {
            if (/0x[0-9a-fA-F]{40}/.test(v)) {
                continue; // hex 40
            }
            if (!isValidCfxAddress(v)) {
                throw new Errors.ParameterError(`Invalid address parameter [${k}] with value [${v}].`);
            }
            const addr = decodeCfxAddress(v)
            if (addr.netId !== netId) {
                throw new Errors.ParameterError(`Invalid address parameter [${k}] with value [${v}], prefix is invalid.`);
            }
            if (/contract/.test(k) && addr.type !== 'contract' && !isEVM) {
                throw new Errors.ParameterError(`Invalid contract parameter [${k}] with value [${v}], type [${addr.type}], it's not a contract address.`);
            }
        }
        obj[k] = vArray;
    }
}

export function mustBeHex64ParamIfPresent(obj, ...keys:string[]) {
    for (const k of keys) {
        const v = obj[k];
        if (v === undefined || v === null) {
            continue
        }
        if (!/0x[0-9a-fA-F]{64}/.test(v)) {
            throw new Errors.ParameterError(`Invalid Hex64 parameter with value [${v}].`);
        }
    }
}

export function mustBeDateParamIfPresent(obj, ...keys:string[]) {
    for(const k of keys) {
        const v = obj[k];
        if (v === undefined || v === null) {
            continue;
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
            throw new Errors.ParameterError(`Invalid date parameter [${k}] with value [${v}]. Expected format: yyyy-MM-dd`);
        }

        const date = new Date(v);
        const [year, month, day] = v.split('-').map(Number);

        if (date.getFullYear() !== year ||
            date.getMonth() + 1 !== month ||
            date.getDate() !== day) {
            throw new Errors.ParameterError(`Invalid date parameter [${k}] with value [${v}].`);
        }
    }
}

export function checkPresent(options, fieldArray){
    lodash.forEach(options, (value, key) => {
        if(lodash.includes(fieldArray, key)){
            if(value === undefined || value === null){
                throw new Errors.ParameterError(`Invalid parameter ${key} with value [${value}], ${key} is required.`);
            }
        }
    });
}

export function removeLongData(obj) {
    if (Array.isArray(obj)) {
        obj.forEach(i=>removeLongData(i))
    } else if (obj){
        Object.keys(obj).forEach(k=>{
            // console.log(`key is ${k}`)
            const v = obj[k]
            if (typeof v === "string") {
                if ( v.length > 200) {
                    obj[k] = 'DataTooLong, hide.'
                }
            } else {
                removeLongData(v)
            }
        })
    }
}

/**
 * 获取 eth0 网卡的 IPv4 地址
 * @returns eth0 的 IPv4 地址，如果找不到则返回空字符串
 */
export function getEth0IP(): string {
    try {
        // 获取所有网络接口信息
        const interfaces = networkInterfaces();

        // 检查 eth0 接口是否存在
        const eth0Interface = interfaces.eth0;
        if (!eth0Interface) {
            console.warn('eth0 interface not found');
            return '';
        }

        // 查找第一个非内部的 IPv4 地址
        const ipv4Info = eth0Interface.find(
            info => info.family === 'IPv4' && !info.internal
        );

        // 返回找到的 IP 地址或空字符串
        return ipv4Info?.address || '';
    } catch (error) {
        console.warn('Error getting eth0 IP:', error instanceof Error ? error.message : String(error));
        return '';
    }
}

export const SECOND = 1000;
export const MINUTE = SECOND * 60;
export const HOUR = MINUTE * 60;

export function getOneMonthAgo() {
    const now = new Date();
    // 30天的毫秒数（近似值，不精确）
    const oneMonthInMs = 30 * 24 * 60 * 60 * 1000;
    return new Date(now.getTime() - oneMonthInMs);
}


export function getTimeToNextHour() {
    return 3600000 - (Date.now() % 3600000);
}
let cfxSdk: Conflux;
export function getCfxSdk() {
    return cfxSdk;
}
export async function initCfxSdk(confluxOption: ConfluxOption, tag: string = undefined) {
	patchFormat();
    try {
        const {setPRCMethodPatch} = require('js-conflux-sdk/src/rpc/rpcPatch');
        setPRCMethodPatch(useFastFormat);
    } catch (e) {
        console.log(`failed to patch RPC: ${e.message}`);
    }
    let cfx: Conflux;

    if(confluxOption?.consortiumMode) {
        cfx = new ConsortiumConflux(confluxOption) as any as Conflux;
    } else{
        cfx = new Conflux(confluxOption);
        confluxOption.url && await cfx.updateNetworkId();
    }
    confluxOption.url && patchHttpProvider(cfx, confluxOption, tag);
    // console.log('conflux networkId', cfx.networkId, 'config', confluxOption);
    cfxSdk = cfx;
    return cfx;
}

export function initEthSdk(url) {
    if (!url) {
        return null;
    }
    return new ethers.JsonRpcProvider(url);
}

export function patchHttpProvider(cfx:Conflux, cfxConf, tag='NotSet') {
    if (cfxConf?.url?.includes('ws')) {
        return;
    }
    // @ts-ignore
    cfx.provider = new ScanHttpProvider(cfxConf, tag);
}

export function batchFetchBlock(cfx:Conflux, hashes:string[], pivot: string, epoch: number) {
    pivot = pivot ?? hashes[hashes.length-1];
    return Promise.all(hashes.map(hash=>{
        return cfx.getBlockByHashWithPivotAssumption(hash, pivot, epoch);
    }))
}

export function formatTrace(arr: (object | Error)[]) {
    arr.forEach((t, idx) => {
        const isError = t instanceof Error;
        if (isError) {
            throw t;
        }
        // @ts-ignore
        arr[idx] = sdk_format.blockTraces(t);
    })
}

export async function getCodeHash(address: string, cfx: Conflux) {
	const code = await cfx.getCode(address);
	return ethers.keccak256(code);
}

export function batchTraceBlock(cfx:Conflux, hashes:string[]) {
    return Promise.all(hashes.map(hash=>{
        return cfx.traceBlock(hash)
    }))
}

export function list2map(arr:any[], key:string) {
    const ret = new Map<any,any>()
    arr.forEach(t=>ret.set(t[key], t))
    return ret;
}

export function checkCodeFormat(codeFormat) {
    if(!codeFormat) {
        throw new Error('code format required')
    }
    if(!CONST.CONTRACT_CODE_FORMATS.includes(codeFormat)) {
        throw new Error(`code format ${codeFormat} not supported`)
    }
}

export function checkSolcVersion(requestVersion, versions) {
    if(!requestVersion) {
        throw new Error('solc version required')
    }

    if(!requestVersion.startsWith('v')) {
        const version = versions[requestVersion]
        if(!version) {
            throw new Error(`solc version ${requestVersion} not supported`)
        }
        return version
    }

    const version = Object.values(versions).find(version => requestVersion === version)
    if(!version) {
        throw new Error(`solc version ${requestVersion} not supported`)
    }
    return version
}

export function checkSolcOptimization(optimizationUsed, runs) {
    optimizationUsed = optimizationUsed === undefined || optimizationUsed === null ? 0 : Number(optimizationUsed);
    runs = runs === undefined || runs === null ? 200 : Number(runs);
    if(optimizationUsed !== 0 && optimizationUsed !== 1){
        throw new Error(`Invalid parameter <optimizationUsed> with value [${optimizationUsed}], expect 0 or 1`);
    }
    if(optimizationUsed === 1 && (!Number.isInteger(runs) || runs < 0)){
        throw new Error(`Invalid parameter <runs> with value [${runs}], expect runs >= 0`);
    }
    return {optimizationUsed, runs}
}

// requestVersion: 0.3.10
// requestVersion: vyper:0.3.10
export function checkVyperVersion(requestVersion, versions) {
    if(!requestVersion) {
        throw new Error('vyper version required')
    }

    if(!requestVersion.startsWith('vyper')) {
        const verInfo = versions[requestVersion]
        if(!verInfo) {
            throw new Error(`vyper version ${requestVersion} not supported`)
        }
        return `${requestVersion}+commit.${verInfo.commit}`
    }

    const verInfo: any = Object.values(versions).find((version: any) => requestVersion === version.desc)
    if(!verInfo) {
        throw new Error(`vyper version ${requestVersion} not supported`)
    }
    return `${requestVersion.substring(6)}+commit.${verInfo.commit}`
}

export function convertVyperVersion(versionWithCommit, versions) {
    return versions[versionWithCommit.split('+')[0]].desc
}

/**
 * default 'gas'
 * >= 0.3.9 default true
 * >= 0.3.0 undefined
 */
export function checkVyperOptimization(optimizationUsed) {
    if(!optimizationUsed) {
        return undefined
    }

    if(!CONST.VYPER_SETTING_OPTIMIZE.includes(optimizationUsed)){
        throw new Error(`Invalid parameter <optimiz> with value [${optimizationUsed}], expect one of ${CONST.VYPER_SETTING_OPTIMIZE.join(',')}`);
    }
    return optimizationUsed
}

export function checkLibrary(libMap) {
    const libraries = {};
    Object.keys(libMap).forEach(library => {
        const {name, address} = libMap[library];
        if ((name && !address) || (!name && address)) {
            throw new Error(`a matching pair required, libraryname ${name} libraryaddress ${address}`);
        }
        if (name && address) {
            libraries[name] = address;
        }
    });
    return libraries;
}

export async function checkEVMVersion(version: string, set: string[]) {
    if(!version) {
        return undefined
    }

    if(!lodash.includes(set, version)) {
        throw new Error(`EVM version ${version} not supported`)
    }

    return version
}

export function checkLicense(licenseType) {
    const types = Object.keys(CONST.CONTRACT_LICENSE).map(Number)
    const min = Math.min(...types)
    const max = Math.max(...types)

    licenseType = licenseType === undefined || licenseType === null ? min : Number(licenseType);
    if(licenseType< min || licenseType > max){
        throw new Error(`Invalid parameter <licenseType> with value [${licenseType}], expect licenseType between ${min} and ${max}`);
    }

    return licenseType
}

export function splitFullyQualifiedName(fullyQualifiedName){
    const splitIdentifier = fullyQualifiedName.split(':');
    const contractName = splitIdentifier[splitIdentifier.length - 1];
    const contractPath = splitIdentifier.slice(0, -1).join(':');
    return { contractPath, contractName };
}


export function emptyField(data) {
    Object.keys(data).forEach(key => (data[key] === null || data[key] === undefined) && (delete data[key]));
    return data;
}

export const INTERVAL_TYPE = {
    min: 'min',
    hour: 'hour',
    day: 'day',
    month: 'month',
};

export const STAT_TYPE_CONVERTER = {
    min: '1m',
    hour: '1h',
    day: '1d',
    month: '1mo',
}

export const ONE_DAY_IN_SECONDS = 86400;
export const ONE_HOUR_IN_SECONDS = 3600;
export const ONE_MIN_IN_SECONDS = 60;

export function calCount(
    {
        minTimestampUTC,
        maxTimestampUTC,
        intervalType,
    }:{
        minTimestampUTC: number,
        maxTimestampUTC?: number,
        intervalType: string,
    }) {
    if (minTimestampUTC === undefined) {
        throw new Error('Parameter minTimestampUTC not provided.');
    }
    if (maxTimestampUTC === undefined) {
        maxTimestampUTC = Math.floor(Date.now() / 1000);
    }

    const intervalConverter = {
        day: ONE_DAY_IN_SECONDS,
        hour: ONE_HOUR_IN_SECONDS,
        min: ONE_MIN_IN_SECONDS,
    };

    const interval = intervalConverter[intervalType];
    if (interval === undefined) {
        throw new Error(`IntervalType ${intervalType} not supported.`);
    }

    return Math.ceil((maxTimestampUTC - (minTimestampUTC - minTimestampUTC % interval)) / interval);
}

export function formatPrice(priceStr) {
    if(priceStr.indexOf('.') >=0 ) {
        priceStr = lodash.trimEnd(priceStr, '0');
        if(priceStr.charAt(priceStr.length-1) === '.'){
            return priceStr.substring(0, priceStr.length-1)
        }
        return priceStr;
    } else {
        return priceStr;
    }
}

export function formatDecimal(numStr, decimal) {
    if(decimal < 0) {
        throw new Error(`Decimal ${decimal} should not less than 0`)
    }

    const segArray = numStr.split('.')
    const dot = decimal === 0 ? '' : '.'

    if(segArray.length === 1) {
        return `${numStr}${dot}${''.padEnd(decimal, '0')}`
    }

    if(segArray[1].length < decimal) {
        return `${segArray[0]}${dot}${segArray[1].padEnd(decimal, '0')}`
    }

    return `${segArray[0]}${dot}${segArray[1].substring(0, decimal)}`
}

export function formatBalance(numStr, decimal) {
    const str = formatDecimal(numStr, decimal)
    const intSum = str
        .substring(0, str.indexOf('.'))
        .replace(/\B(?=(?:\d{3})+$)/g, ',')
    let dot = str.substring(str.length, str.indexOf('.'))
    return `${intSum}${dot}`
}

export function formatPercentage(numStr, decimal) {
    const minVal = decimal === 0 ? '0' : `0.${''.padEnd(decimal-1, '0')}1`

    if(Number(numStr) < Number(minVal)) {
        return `<${minVal}%`
    }

    const percentage = formatDecimal(numStr, decimal)
    return `${percentage}%`
}

export function extractActualGasCost(msg) {
    if (!msg) {
        return
    }

    const index = msg.indexOf('actual_gas_cost:')
    if (index < 0) {
        return
    }

    const start = index + 'actual_gas_cost:'.length
    let end = start
    while (end < msg.length && msg[end] !== ',' && msg[end] !== '}') {
        end++
    }

    return parseInt(msg.substring(start, end))
}

export async function sendRpc(provider: any, method: string, rpcParams: any[], options?: {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
}): Promise<any> {
    const opts = {
        timeout: options?.timeout || 5000,
        retries: options?.retries || 3,
        retryDelay: options?.retryDelay || 1000,
    };

    let lastError: Error | null = null;
    for (let i = 0; i < opts.retries; i++) {
        try {
            const result = await Promise.race([
                sendRpcRaw(provider, method, rpcParams),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Errors.RPCError(`Failed to get response by sdk: timeout ${opts.timeout}ms`)), opts.timeout)
                ),
            ]);

            return result;
        } catch (error: any) {
            lastError = error;
            if (error.message?.includes('method not found') ||
                error.message?.includes('unauthorized')) {
                throw error;
            }

            if (i < opts.retries - 1) {
                const delay = opts.retryDelay * Math.pow(2, i);
                await new Promise(resolve => setTimeout(resolve, delay))
            }
        }
    }

    throw lastError || new Errors.RPCError(`Failed to get response by sdk: retry ${opts.retries} times`);
}

export async function sendRpcRaw(provider: any, method: string, params: any[]): Promise<any> {
    let result;
    try {
        result = await provider.send(method, params);
    } catch (error: any) {
        throw new Errors.RPCError(`Failed to get response by sdk: ${error}`);
    } finally {
        console.log("RPC", JSON.stringify({method, params, result}));
    }
    return result;
}

export function formatCallParams(params: CallParams): CallParams {
    const formatted: CallParams = {};

    if (params.from) formatted.from = params.from;
    if (params.to) formatted.to = params.to;

    if (params.data) {
        formatted.data = params.data;
    } else if (params.input) {
        formatted.data = params.input;
    }

    if (params.type !== undefined) {
        formatted.type = ethers.toQuantity(params.type);
    }

    if (params.accessList && params.accessList.length > 0) {
        formatted.accessList = params.accessList;
    }

    if (params.authorizationList && params.authorizationList.length > 0) {
        formatted.authorizationList = params.authorizationList.map(auth => ({
            chainId: ethers.toQuantity(ethers.toBigInt(auth.chainId)),
            address: auth.address,
            nonce: ethers.toQuantity(ethers.toBigInt(auth.nonce)),
            yParity: auth.yParity,
            r: auth.r,
            s: auth.s,
        }));
    }

    ["value", "gas", "maxPriorityFeePerGas", "maxFeePerGas", "gasPrice", "nonce", "chainId"].forEach(item => {
        if (params[item] !== undefined) {
            formatted[item] = ethers.toQuantity(ethers.toBigInt(params[item]));
        }
    })

    return formatted;
}

export function formatBlockNumber(blockNumber: ethers.BlockTag): string {
    if (typeof blockNumber === 'number' || typeof blockNumber === 'bigint') {
        return ethers.toQuantity(blockNumber);
    }
    return blockNumber;
}
