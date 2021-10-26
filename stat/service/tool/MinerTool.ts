import {Conflux} from "js-conflux-sdk";

let sum = BigInt(0)
async function getReward(epoch:number, minerBase32:string, cfx:Conflux) {
    return cfx.getBlockRewardInfo(epoch).then(arr=>{
        return arr.filter(info=>{
            // console.log(`epoch ${epoch} author ${info['author']}`)
            return info['author'] === minerBase32
        })
    })
}

async function processEpoch(epoch, minerBase32, cfx) {
    return getReward(epoch, minerBase32, cfx).then(arr=>{
        for(const info of arr) {
            // @ts-ignore
            const tr = info.totalReward;
            sum += BigInt(tr)
            console.log(`epoch ${epoch} total reward ${tr}, sum ${sum}`)
        }
    })
}
async function run(start, end, cfx, minerBase32) {
    // @ts-ignore
    await cfx.updateNetworkId()
    // @ts-ignore
    const networkId = cfx.networkId;
    console.log(`network id ${networkId}`)
    while(start<end) {
        await processEpoch(start, minerBase32, cfx)
        start++
    }
}
const args = process.argv.slice(2)
// node this start end cfxUrl
const [start, end, cfxUrl, minerBase32] = args
run(Number(start), Number(end), new Conflux({url: cfxUrl}), minerBase32).then()

