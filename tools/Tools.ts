const superagent = require('superagent');

async function run() {
    const url = 'https://confluxscan.io/v1/contract/'
    // const dataHost = 'http://localhost:8087/stat/top-cfx-holder?type='
    const dataHost = 'http://47.242.229.73:8087/stat/top-cfx-holder?type='
    const types = ['rank_address_by_staking']
    const res = await superagent.get(`${dataHost}${types[0]}&limit=100`).end(
        (err, res)=>{
            if (err) {
                console.log(`error:`, err)
            }
            return res;
        }
    )
    console.log('res is :', res)
}

console.log(`run tools.`)
run().then().catch(err=>{
    console.log(`run tool fail:`, err)
})