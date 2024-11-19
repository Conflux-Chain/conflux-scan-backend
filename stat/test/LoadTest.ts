export {} // placeholder
const superagent = require('superagent')
async function main() {
    let n = 52
    let host = 'http://localhost:9001'
    let url = '/stat/real?a=1&b='+encodeURIComponent('哈')
    for (let i = 0; i<n; i++) {
        superagent.post(`${host}${url}`).then(({body})=>{
            console.log(`${i} ${JSON.stringify(body)}`)
        })
    }
    console.log(`done`)
}
if (module === require.main) {
    main().then()
}
