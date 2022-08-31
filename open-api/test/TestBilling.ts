import {loadConfig} from "../../stat/config/StatConfig";
import {billing, initWeb3payClient} from "web3pay-sdk-js/lib/rpc";

async function main() {
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