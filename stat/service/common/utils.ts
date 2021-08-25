import {Conflux} from "js-conflux-sdk";
const format = require('js-conflux-sdk/src/util/format');
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

export function intParam(obj: object, key: string, defaultV: number) {
    const v = obj[key]
    if (v === undefined || v === null) {
        return defaultV
    }
    try {
        return parseInt(v);
    } catch (e) {
        return defaultV
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