async function rpc(url) {
    // let host = 'https://confluxscan.io'
    console.log(` host is `, host)
    return fetch(host+url).then(res=>res.json())
}
let host = process.env.VUE_APP_HOST
function setHost(h) {
   host = h;
    console.log(` set host `, h)
}
module.exports = {rpc, host, setHost}