const addressSdk = require('js-conflux-sdk/src/util/address')
// @ ts-ignore
// import {format} from "js-conflux-sdk";
export function base32toVerbose(base32:string) {
    const addrObj = addressSdk.decodeCfxAddress(base32)
    return addressSdk.encodeCfxAddress(addrObj.hexAddress, addrObj.netId, true)
}