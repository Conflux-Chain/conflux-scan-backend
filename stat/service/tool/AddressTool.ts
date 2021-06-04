import {StatApp} from "../../StatApp";
const addressSdk = require('js-conflux-sdk/src/util/address')
const { address ,format} = require('js-conflux-sdk');

// @ ts-ignore
// import {format} from "js-conflux-sdk";
export function base32toVerbose(base32:string) {
    const addrObj = addressSdk.decodeCfxAddress(base32)
    return addressSdk.encodeCfxAddress(addrObj.hexAddress, addrObj.netId, true)
}

export function toBase32(addr:string){
    let base32 = addr;
    if(addr.startsWith('CFX')){
        base32 = address.simplifyCfxAddress(addr);
    }
    if(addr.startsWith('0x')){
        base32 = format.address(addr, StatApp.networkId);
    }
    return base32;
}
