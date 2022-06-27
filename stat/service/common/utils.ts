import {Conflux} from "js-conflux-sdk";
const format = require('js-conflux-sdk/src/rpc/types/formatter');
const {isValidCfxAddress, decodeCfxAddress} = require('js-conflux-sdk/src/util/address');
import {ScanHttpProvider} from "./ScanHttpProvider";
import {ConfluxOption} from "../../config/StatConfig";
const lodash = require('lodash');
const addressUtil = require('js-conflux-sdk/src/util/address');
export function pageParam(obj: object, skipKey: string, limitKey: string, defaultLimit: number) {
    const param = {
        skip: intParam(obj, skipKey, 0),
        limit: intParam(obj, limitKey, defaultLimit)
    };
    if (param.skip > 10000) {
        throw new Error('Parameter <skip> exceeds 10000')
    }
    if (param.limit > 100) {
        throw new Error('Parameter <limit> exceeds 100')
    }
    return param
}
export function getPagination(requestObj: object, {defaultSkip, maxSkip, defaultLimit, maxLimit}:
    {defaultSkip: number, maxSkip: number, defaultLimit: number, maxLimit: number}
    = {defaultSkip: 0, maxSkip: 10000, defaultLimit: 10, maxLimit: 10000}
) {
    const param = {
        skip: intParam(requestObj, 'skip', defaultSkip),
        limit: intParam(requestObj, 'limit', defaultLimit)
    };
    if (param.skip > maxSkip) {
        throw new Error(`Parameter <skip> exceeds ${maxSkip}`)
    }
    if (param.limit > maxLimit) {
        throw new Error(`Parameter <limit> exceeds ${maxLimit}`)
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
        throw new Error(`Parameter <page> starts at 1`)
    }
    if (param.page > maxPage) {
        throw new Error(`Parameter <page> exceeds ${maxPage}`)
    }
    if (param.offset < 1) {
        throw new Error(`Parameter <offset>'s minimum value is 1`)
    }
    if (param.offset > maxOffset) {
        throw new Error(`Parameter <offset> exceeds ${maxOffset}`)
    }
    return param
}
export function patchFormat() {
    const fun = format.address;
    function saveAddress(str, networkId, verbose) {
        try {
            return fun(str, networkId, verbose)
        } catch (e) {
            return str;
        }
    }
    format.address = saveAddress;
}
export function noVerboseAddr(v) {
    const obj = addressUtil.decodeCfxAddress(v)
    const simple = format.address(obj.hexAddress, obj.netId)
    return simple;
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
        throw new InvalidParamError(`Invalid parameter [${key}] with value[${v}]`)
    }
    let number: number;
    try {
        number = parseInt(v);
    } catch (e) {
        return defaultV
    }
    if (isNaN(number)) {
        throw new InvalidParamError(`Invalid parameter [${key}] with value [${v}]`)
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
            throw new InvalidParamError(`Invalid parameter [${k}] with value [${v}].`)
        }
        obj[k] = parseInt(v);
        if (/imestamp/.test(k)) {
            let dt = new Date(v * 1000)
            const tm = dt.getTime();
            if (isNaN(tm) || dt.getFullYear() > 3000) {
                throw new InvalidParamError(`Invalid timestamp parameter (in second format) [${k}] with value [${v}].`)
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
    throw new InvalidParamError(`Invalid parameter [${key}] with value [${v}]. Should be one of [${options.join(',')}]`)
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
        throw new InvalidParamError(`Invalid parameter [${key}] with value [${v}]. Should be one of [${options.join(',')}]`)
    }
}
export function mustBeAddressParamIfPresent(obj, netId, ...keys:string[]) {
    for(const k of keys) {
        const v = obj[k];
        if (v === undefined || v === null) {
            continue
        }
        if (/0x[0-9a-fA-F]{40}/.test(v)) {
            continue // hex 40
        }
        if (!isValidCfxAddress(v)) {
            throw new InvalidParamError(`Invalid address parameter [${k}] with value [${v}].`);
        }
        const addr = decodeCfxAddress(v)
        if (addr.netId !== netId) {
            throw new InvalidParamError(`Invalid address parameter [${k}] with value [${v}], prefix is invalid.`);
        }
        if (/contract/.test(k) && addr.type !== 'contract') {
            throw new InvalidParamError(`Invalid contract parameter [${k
            }] with value [${v}], type [${addr.type}], it's not a contract address.`);
        }
    }
}
export function mustBeHex64ParamIfPresent(obj, ...keys:string[]) {
    for (const k of keys) {
        const v = obj[k];
        if (v === undefined || v === null) {
            continue
        }
        if (!/0x[0-9a-fA-F]{64}/.test(v)) {
            throw new InvalidParamError(`Invalid Hex64 parameter with value [${v}].`);
        }
    }
}
export function checkPresent(options, fieldArray){
    lodash.forEach(options, (value, key) => {
        if(lodash.includes(fieldArray, key)){
            if(value === undefined || value === null){
                throw new InvalidParamError(`Invalid ${key} parameter with value [${value}], ${key} is required.`);
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
export function createConflux(cfxConf:ConfluxOption) {
    const cfx = new Conflux(cfxConf);
    patchHttpProvider(cfx, cfxConf)
    return cfx;
}
export function patchHttpProvider(cfx:Conflux, cfxConf, tag='NotSet') {
    if (cfxConf?.url?.includes('ws')) {
        return;
    }
    // @ts-ignore
    cfx.provider = new ScanHttpProvider(cfxConf, tag);
}
// batch fetch block detail, with transaction and trace.
export function batchBlockDetail(cfx: Conflux, hashes: string[]) : Promise<[any[],any[]]> {
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
        arr[idx] = format.blockTraces(t);
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
