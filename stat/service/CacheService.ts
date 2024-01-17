import * as fs from "fs";

export const PATH_POS_INFO = "./cache/pos_info.json"
export const PATH_TOP_BY_GAS = "./cache/topByGasUsed"

export function resolveDockerPath(relativePath: string) {
    return `${process.cwd().length == 1 ? "/"+__dirname.split("/")[1] : process.cwd()}/${relativePath}`
}
const cacheTimeProp = 'cacheCreatedAt';

export function writeCache(cachePath: string, data: Object) {
    data[cacheTimeProp] = new Date().toISOString()
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 4), {flag: 'w'})
}
export function loadCache(path: string, expirationSeconds: number) {
    try {
        if (!fs.existsSync(path)) {
            console.log(`file not exist ${path}`)
            return undefined
        }
        const content = fs.readFileSync(path);
        const str = content.toString()
        const json = JSON.parse(str)
        if (expirationSeconds > 0) {
            // The 'createdAt' key is deprecated, but is currently supported.
            const createdAt = new Date(json[cacheTimeProp] || json['createdAt']);
            if (createdAt.getTime() + expirationSeconds * 1000 < Date.now()) {
                // console.log(`${path} expired`)
                return undefined
            }
        }
        // console.log(`hit cache ${path}`)
        return json
    } catch (e) {
        console.log(`failed to load cache at ${path} `, e)
    }
    return undefined
}
