import {Conflux, format as sdk_format} from "js-conflux-sdk";
import {Errors} from "./LogicError";
import {ScanHttpProvider} from "./ScanHttpProvider";
import {ConfluxOption} from "../../config/StatConfig";
import {CONST} from "./constant"
import {ethers} from "ethers";
import {ConsortiumConflux} from "./ConsortiumConflux";

const lodash = require('lodash');
const format = require('js-conflux-sdk/src/rpc/types/formatter');
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
    const simple = sdk_format.address(obj.hexAddress, obj.netId)
    return simple;
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

export function mustBeEnumParamsIfPresent(obj, options:string[], ...keys:string[]) {
    for (const key of keys) {
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
            vArray = [vArray];
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

export async function initCfxSdk(confluxOption: ConfluxOption, tag: string = undefined) {
    let cfx: any;

    if(confluxOption?.consortiumMode) {
        cfx = new ConsortiumConflux(confluxOption);
    } else{
        cfx = new Conflux(confluxOption);
        confluxOption.url && await cfx.updateNetworkId();
    }
    confluxOption.url && patchHttpProvider(cfx, confluxOption, tag);
    // console.log('conflux networkId', cfx.networkId, 'config', confluxOption);

    return cfx;
}

export function initEthSdk(url) {
    return new ethers.providers.JsonRpcProvider(url);
}

export function patchHttpProvider(cfx:Conflux, cfxConf, tag='NotSet') {
    if (cfxConf?.url?.includes('ws')) {
        return;
    }
    // @ts-ignore
    cfx.provider = new ScanHttpProvider(cfxConf, tag);
}

// batch fetch block detail, with transaction and trace.
export async function batchBlockDetail(cfx: Conflux, hashes: string[], consortiumMode: boolean = false) : Promise<[any[],any[]]> {
    if(consortiumMode) {
        const rpcBlocks = hashes.map(hash=>{return {"method": "cfx_getBlockByHash","params": [hash, true]}});
        let traces = [];
        for (const hash of hashes) {
            const trace = await cfx.traceBlock(hash);
            traces.push(trace);
        }
        return cfx.provider.batch(rpcBlocks).then(blocks=>{
            formatBlock(blocks)
            return [blocks, traces]
        })
    }

    const rpcBlocks = hashes.map(hash=>{return {"method": "cfx_getBlockByHash","params": [hash, true]}});
    const rpcTraces = hashes.map(hash=>{return {"method": "trace_block","params": [hash]}});
    const rpcBoth = [...rpcBlocks, ...rpcTraces]
    const len = hashes.length
    return cfx.provider.batch(rpcBoth).then(arr=>{
        const blocks = arr.slice(0, len)
        formatBlock(blocks)
        const traces = arr.slice(len)
        formatTrace(traces)
        return [blocks, traces]
    })
}

function formatBlock(arr) {
    arr.forEach((blk, idx)=>{
        arr[idx] = format.block.$or(null)(blk);
    })
}

export function batchFetchBlock(cfx:Conflux, hashes:string[],
                                detail = true, doFormat = true) : Promise<any[]> {
    return cfx.provider.batch(
        hashes.map(hash=>{
            return {"method": "cfx_getBlockByHash",
                params: [hash, detail]}
        })
    ).then(arr=>{
        if (doFormat) {
            formatBlock(arr)
        }
        return arr
    })
}

export function isNewFormatTrace(traceArray2d:any[] = []) {
    // the 1st trace is always gas payment (for now in evm hard-fork)
    for (let blk of traceArray2d) {
        for (let tx of blk?.transactionTraces || []) {
            for (let r of tx?.traces || []) {
                const {action:{ fromPocket, toPocket, fromSpace, toSpace, space }} = r;
                if(fromPocket || toPocket || fromSpace || toSpace || space) {
                    return true;
                }
            }
        }
    }
    return false;
}

function formatTrace(arr: (object | Error)[]) {
    arr.forEach((t, idx) => {
        const isError = t instanceof Error;
        if (isError) {
            console.log('trace error:', t)
        }
        // @ts-ignore
        arr[idx] = sdk_format.blockTraces(t);
    })
}

export function batchTraceBlock(cfx:Conflux, hashes:string[]) {
    return cfx.provider.batch(
        hashes.map(hash=>{
            return {"method": "trace_block",
                params: [hash]}
        })
    ).then(arr=>{
        formatTrace(arr);
        return arr
    })
}

export function markCallResult(traces:any[]) {
    const stack = []
    for(let tr of traces) {
        const {type, action: {outcome}} = tr
        if (type === 'call_result') {
            const pre = stack.pop()
            pre.markCallResult = outcome
            tr.markCallResult = outcome
            continue
        }
        if (type !== 'call') {
            tr.markCallResult = 'success';
            continue
        }
        stack.push(tr)
    }
    if (stack.length) {
        throw new Error(`check trace stack still has element: ${stack.length}. traces:\n ${JSON.stringify(traces)}`);
    }
}

export function list2map(arr:any[], key:string) {
    const ret = new Map<any,any>()
    arr.forEach(t=>ret.set(t[key], t))
    return ret;
}

// reverse to v,k
export function reverseMap(map:Map<any, any>) {
    const ret = new Map<any, any>()
    for(const k of map.keys()){
        ret.set(map.get(k), k)
    }
    return ret;
}

export function checkExist(options, fieldArray){
    let prunedFlag = true;
    lodash.forEach(options, (value, key) => {
        if(lodash.includes(fieldArray, key)){
            prunedFlag = prunedFlag && (value !== undefined);
        } else {
            prunedFlag = prunedFlag && (value === undefined);
        }
    });
    return prunedFlag;
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

export function checkEVMVersion(evmVersion) {
    evmVersion = !evmVersion ? '' : evmVersion;
    if(evmVersion !== '' && !lodash.includes(CONST.EVM_VERSION, evmVersion)) {
        throw new Error(`EVM version ${evmVersion} not supported`);
    }
    return evmVersion;
}

export function emptyField(data) {
    Object.keys(data).forEach(key => (data[key] === null || data[key] === undefined) && (delete data[key]));
    return data;
}

export const INTERVAL_TYPE = {min: 'min', hour: 'hour', day: 'day', month: 'month'};
export function calCount(minTimestamp, maxTimestamp, intervalType) {
    const start = minTimestamp !== undefined ? minTimestamp : (new Date('2020-10-28 16:00:00')).getTime();
    const end = maxTimestamp !== undefined ? maxTimestamp : Date.now();
    const elapsed = end - start;

    let count;
    switch (intervalType) {
        case INTERVAL_TYPE.day:
            count = elapsed / (1000 * 60 * 60 * 24);
            break;
        case INTERVAL_TYPE.hour:
            count = elapsed / (1000 * 60 * 60);
            break;
        case INTERVAL_TYPE.min:
            count = elapsed / (1000 * 60);
            break;
        default:
            throw new Error(`intervalType:${intervalType} not supported`);
    }

    return Math.ceil(count);
}
