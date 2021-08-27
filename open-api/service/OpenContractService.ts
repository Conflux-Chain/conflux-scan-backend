import {getApiService} from "../ApiServer";

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
    const basicInfo = await getApiService().contractQuery.listBasic({addressArray:[...contract], iconUrl: true})
    const map = basicInfo.map
    Object.keys(map).forEach(k=>{
        map[k] = map[k].token
        if (map[k].contract?.verify?.result) {
            map[k].verifed = true
        }
        if (map[k].tokenType) {
            map[k].tokenType = map[k].tokenType.replace('ERC', 'CRC')
        }
        delete map[k].contract
        delete map[k].token
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