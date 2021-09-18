const mainMap = new Map<number,Map<number, any>>()
export function put(addr, tokenId, obj) {
    let subMap = mainMap.get(addr)
    if (!subMap) {
        subMap = new Map<number, any>()
        mainMap.set(addr, subMap)
    }
    subMap.set(tokenId, obj)
}
export function get(addr, tokenId) {
    let subMap = mainMap.get(addr)
    if (!subMap) {
        return null
    }
    return subMap.get(tokenId)
}
export function clear(addr, tokenId) {
    let subMap = mainMap.get(addr)
    if (!subMap) {
        return
    }
    if (tokenId) {
        subMap.delete(tokenId)
    } else {
        subMap.clear()
    }
}
