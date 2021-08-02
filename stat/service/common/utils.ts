import {Conflux} from "js-conflux-sdk";
const format = require('js-conflux-sdk/util/format');
import {ScanHttpProvider} from "./ScanHttpProvider";

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

export function batchFetchBlock(cfx:Conflux, hashes:string[],
                                detail = true, doFormat = true) : Promise<any[]> {
    return cfx.provider.batch(
        hashes.map(hash=>{
            return {"method": "cfx_getBlockByHash",
                params: [hash, detail]}
        })
    ).then(arr=>{
        if (doFormat) {
            arr.forEach((blk, idx)=>{
                arr[idx] = format.block.$or(null)(blk);
            })
        }
        return arr
    })
}
export function batchTraceBlock(cfx:Conflux, hashes:string[]) {
    return cfx.provider.batch(
        hashes.map(hash=>{
            return {"method": "trace_block",
                params: [hash]}
        })
    ).then(arr=>{
        arr.forEach((t, idx)=>{
            arr[idx] = format.blockTraces(t);
        })
        return arr
    })
}