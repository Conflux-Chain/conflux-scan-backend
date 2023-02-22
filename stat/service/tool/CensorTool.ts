const AipContentCensorClient = require("baidu-aip-sdk").contentCensor;
const HttpClient = require("baidu-aip-sdk").HttpClient;
const {loadConfig} = require("../../config/StatConfig");

let client;

function init() {
    const config = loadConfig('Prod')
    const {censorAppId, censorApiKey, censorSecretKey} = config;
    HttpClient.setRequestOptions({timeout: 3000});
    client = new AipContentCensorClient(censorAppId, censorApiKey, censorSecretKey);
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

export function hexToUtf8(hex){
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

export function utf8ToHex(utf8){
    let result = {success: false} as any;

    try{
        result.data = unescape(encodeURIComponent(utf8))
            .split('').map(function(v){
                return v.charCodeAt(0).toString(16).padStart(2, "0")
            }).join('')
        result.success = true;
    } catch(e){
    }

    return result
}

function test() {
    const expect = `
The Times 28/Oct/2020 Fees for current accounts as negative rates loom`;

    const hex = '0a5468652054696d65732032382f4f63742f32303230204665657320666f722063757272656e74206163636f756e7473206173206e65676174697665207261746573206c6f6f6d';
    const {data: utf8} = hexToUtf8(hex);
    console.log(`
hexToUtf8
pass: ${expect === utf8} 
result: ${utf8}
`);

    // a5468652054696d65732032382f4f63742f32303230204665657320666f722063757272656e74206163636f756e7473206173206e65676174697665207261746573206c6f6f6d
    const {data: hex2} = utf8ToHex(utf8);
    console.log(`
utf8ToHex
pass: ${hex === hex2} 
result: ${hex2}
`);
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const text = args[0];
    init();
    censor(text, true).then();
}