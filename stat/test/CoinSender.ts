import {BalanceWatcher} from "../service/watcher/BalanceWatcher";
import {initCfxSdk} from "../service/common/utils";
const addressSdk = require('js-conflux-sdk/src/util/address')
const conf = require('./CoinSenderConf')

let cfx;
let sender = {};
const receivers = [];

async function run(round) {
    cfx = await initCfxSdk({url: conf.rpcHost});
    await buildMainAccount()
    await checkBalance()
    let i = BigInt(0)
    // @ts-ignore
    let nonce:BigInt = await cfx.getNextNonce(sender.address)
    const start = new Date().getTime();
    let batchSize = 1;
    let arr = []
    while (i < round) {
        // @ts-ignore
        arr.push(send(i, nonce+i))
        if (arr.length == batchSize) {
            await Promise.all(arr)
            arr = []
        }
        i++;
    }
    const end = new Date().getTime();
    const tps = round / ((end-start)/1000)
    console.log(`round ${round} tps ${tps}, batch size ${batchSize}`)
}

async function checkBalance() {
    const ban:BigInt = await cfx.getBalance(sender.toString())
    let cfxU = BalanceWatcher.drip2cfx(ban, 1e+18)
    console.log(`balance of main account ${sender.toString()} is ${cfxU}`)
}

async function send(i:BigInt, nonce:number) {
    if (receivers.length < 1000) {
        receivers.push(cfx.wallet.addRandom())
    }
    const receiver = receivers[receivers.length-1]
    // @ts-ignore
    const receiverHex = addressSdk.simplifyCfxAddress(receiver.address);
    let txParams = {
        from: sender, // from account instance and will by sign by account.privateKey
        nonce,
        // gasPrice
        // gas
        to: receiverHex, // accept address string or account instance
        value: 1, // use the conversion utility function
        // storageLimit
        // epochHeight
        // data
    };
    // @ts-ignore
    const txHash = await cfx.sendTransaction(txParams)
    console.log(`${new Date().toISOString()} send tx hash ${txHash}`)
}

async function buildMainAccount() {
    // @ts-ignore
    console.log(`${conf.rpcHost} networkId ${cfx.networkId}`)
    if (!conf.mainAccountPK) {
        sender = cfx.wallet.addRandom()
        // @ts-ignore
        console.log(`please save pk: ${sender.privateKey}`)
    } else {
        sender = cfx.wallet.addPrivateKey(conf.mainAccountPK);
    }
    console.log(`account ${sender}`)
    //
    for( const key in cfx.wallet.keys()) {
        console.log(`wallet key: ${key}`)
    }
}

const args = process.argv.slice(2)
const round = Number(args[0] || 1)
run(round).then(()=>{
    console.log(`done`)
})
