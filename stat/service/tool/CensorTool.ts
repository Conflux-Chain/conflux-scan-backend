const AipContentCensorClient = require("baidu-aip-sdk").contentCensor;
const HttpClient = require("baidu-aip-sdk").HttpClient;
const {loadConfig} = require("../../config/StatConfig");

let client;

function init() {
    const config = loadConfig('Prod')
    const {enable, appId, apiKey, secretKey} = config.censor;
    if (!enable) {
        console.log("Censor service disabled!");
        return;
    }
    HttpClient.setRequestOptions({timeout: 3000});
    client = new AipContentCensorClient(appId, apiKey, secretKey);
}

export async function censor(text, debug = false) {
    const result = await client.textCensorUserDefined(text);
    if (debug) {
        console.log(`censor ---> ${text}`);
        console.log(`result --->`);
        console.log(result);
    }
    return result;
}

export function hexToUtf8(hex) {
    let result = {success: false} as any;

    try {
        result.data = decodeURIComponent(
            hex.replace(/\s+/g, '').replace(/[0-9a-f]{2}/g, '%$&'),
        );
        result.success = true;
    } catch (e) {
    }

    return result;
}

export function utf8ToHex(utf8) {
    let result = {success: false} as any;

    try {
        result.data = unescape(encodeURIComponent(utf8))
            .split('').map(function (v) {
                return v.charCodeAt(0).toString(16).padStart(2, "0")
            }).join('')
        result.success = true;
    } catch (e) {
    }

    return result
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const text = args[0];
    init();
    censor(text, true).then();
}