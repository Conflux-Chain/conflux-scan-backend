import {Conflux} from "js-conflux-sdk";
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