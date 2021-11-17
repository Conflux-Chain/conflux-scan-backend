async function rpc(url) {
    let host = 'https://confluxscan.io'
    return fetch(host+url).then(res=>res.json())
}
module.exports = {rpc}