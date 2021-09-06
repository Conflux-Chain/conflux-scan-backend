import {Conflux} from "js-conflux-sdk";
const format = require('js-conflux-sdk/src/util/format');
const {isValidCfxAddress} = require('js-conflux-sdk/src/util/address');
import {ScanHttpProvider} from "./ScanHttpProvider";
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

export function skipLimit(obj) {
    return pageParam(obj, 'skip', 'limit', 10)
}
export class InvalidParamError extends Error{}
export function intParam(obj: object, key: string, defaultV: number) {
    const v = obj[key]
    if (v === undefined || v === null) {
        return defaultV
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
        if (isNaN(parseInt(v))) {
            throw new InvalidParamError(`Invalid parameter ${k} with value [${v}].`)
        }
    }
}
export function mustBeAddressParamIfPresent(obj, ...keys:string[]) {
    for(const k of keys) {
        const v = obj[k];
        if (v === undefined || v === null) {
            continue
        }
        if (/0x[0-9a-fA-F]{40}/.test(v)) {
            continue // hex 40
        }
        if (isValidCfxAddress(v)) {
            continue
        }
        throw new InvalidParamError(`Invalid address parameter [${k}] with value [${v}].`);
    }
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

export function patchHttpProvider(cfx:Conflux, cfxConf, tag='NotSet') {
    // @ts-ignore
    cfx.provider = new ScanHttpProvider(cfxConf, tag)
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

function formatTrace(arr: (object | Error)[]) {
    arr.forEach((t, idx) => {
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