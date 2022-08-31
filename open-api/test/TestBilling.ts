import {loadConfig} from "../../stat/config/StatConfig";
import {billing, initWeb3payClient} from "web3pay-sdk-js/lib/rpc";
import {buildApiKey} from "web3pay-sdk-js";

async function main() {
    //
    const [,,cmd,input,pk] = process.argv
    if (cmd === 'buildApiKey') {
        const key = await buildApiKey(input, pk)
        console.log(key)
        return
    }
    //
    const config = loadConfig("Prod")
    const {billingUrl, billingKey} = config
    console.log(`billing url ${billingUrl}`)
    console.log(`billing key ${billingKey}`)
    await initWeb3payClient(billingUrl, billingKey)
    const result = await billing("/", true, billingKey);
    console.log(`billing result`, result)
}
if (module === require.main) {
    main().then()
}