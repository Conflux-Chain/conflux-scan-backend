import {getApiService} from "../ApiServer";
import {fixIconUrl} from "./OpenAccountService";

export async function polishContract(page, needAddressInfo) {
    if ('true' !== needAddressInfo) {
        // return // always true.
    }
    const contract = new Set<string>();
    function add(row, key) {
        const address = row[key];
        if (address && address.substr(address.indexOf(':')).startsWith(':ac')) {
            contract.add(address)
        }
    }
    page?.list?.forEach(row=>{
        add(row, 'from')
        add(row, 'to')
        add(row, 'contract')
    })
    if (!contract.size) {
        return
    }
    const basicInfo = await getApiService().contractQuery.listBasic({addressArray:[...contract]})
    const map = basicInfo.map
    Object.keys(map).forEach(k=>{
        const contract = map[k].contract
        const token = map[k].token || {}
        if (contract?.verify?.result) {
            token.verifed = true
        }
        if (!token.name && contract?.name) {
            token.name = contract.name
        }
        if (token.tokenType) {
            token.tokenType = token.tokenType.replace('ERC', 'CRC')
        }
        fixIconUrl(token, 'address')
        map[k] = token
        delete token.address
        // delete map[k].contract
        // delete map[k].token
        // removeEmptyKey(map[k], 'contract')
        // removeEmptyKey(map[k], 'token')
        // removeEmptyKey(map, k)  // keep address, help debugging.
    })
    page.addressInfo = basicInfo.map
}
export function removeEmptyKey(obj, key) {
    if (isEmptyObj(obj[key])) {
        delete obj[key]
    }
}
export function isEmptyObj(obj) {
    return !obj || !Object.keys(obj).map(k=>obj[k]).some(v=> v!==undefined && v!==null)
}