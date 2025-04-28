import {IS_EVM2, KV} from "../../model/KV";
import {Conflux, format} from "js-conflux-sdk";
import {abi} from "./EnsCheckerAbi";

// ----
let contract = null;
let isEvm = false
let ens = '0xC7b7224F76dD98bE23b717668d55cB40E9B3DF7f' // net71
let reverse = '0x03eD9a24B0c38D1903E34d7787B1EB69B4F8ccfA' //net71
let chainId;
export async function setupEnsChecker(cfx:Conflux, forceEvm = false) {
    isEvm = forceEvm || await KV.getSwitch(IS_EVM2)
    chainId = await cfx.getStatus()
    if (!isEvm || chainId != 71) {
        return
    }
    isEvm = true;
    if (!contract) {
        let address = '0x14c5eD9a711A44ccEecE0d504B25300E1ac36E2F'
        contract = cfx.Contract({abi, address})
    }
}
export async function matchNamesOnChain(addrArr: string[], domain: string = ".cfx") {
    if (!isEvm) {
        return {isEvm}
    }
    const ret = {ens, reverse};
    const nameArr = await contract.matchNames(ens, reverse, addrArr, domain).catch(err=>{
        console.log(`ens matchNames fail`, err)
        ret["error"] = err;
    })
    for (let i = 0; i < addrArr.length; i++) {
        ret[addrArr[i]] = nameArr[i] || ''
    }
    return ret;
}
export async function getAddrOfName(name: string) {
    return contract.getAddrOfName(ens, reverse, name);
}

export async function getReverseNameByAddress(addr: string) {
    return contract.getReverseNameByAddress(ens, reverse, addr);
}
export async function fetchEnsMap(list:any[], ...keys:string[]) {
    if (!isEvm || chainId != 71) {
        return {isEvm};
    }
    const hexSet = new Set<string>()
    for(const row of list) {
        for(const key of keys) {
            const addr = row[key] || ''
            if (addr.length < 42) {
                continue
            }
            let hex = addr
            if (!addr.startsWith('0x')) {
                hex = format.hexAddress(addr)
            }
            row[`${key}Hex`] = hex
            hexSet.add(hex)
        }
    }
    const hexArr = [...hexSet]
        .filter(addr=>addr?.length >= 42)
        .map(addr => format.hexAddress(addr));
    if (hexArr.length === 0) {
        return {}
    }
    const ensMap = await matchNamesOnChain(hexArr);
    for(const row of list) {
        for (const key of keys) {
            let hexKey = `${key}Hex`;
            const hex = row[hexKey]
            delete row[hexKey]
            if (!hex){
                continue
            }
            row[`${key}EnsInfo`] = {
                hex, name: ensMap[hex]
            }
        }
    }
    return ensMap
}
