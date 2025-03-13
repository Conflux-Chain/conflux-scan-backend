import {redirectLog} from "./config/LoggerConfig";
import {regExitHook} from "./service/tool/ProcessTool";
import {startSync3525} from "./T3525Sync";
import {startBalanceTask, startContractUserAnd1155data} from "./service/watcher/BatchBalanceWatcher";
import { init } from "./service/tool/FixDailyTokenStat";
import {startUniqueAddrStat} from "./service/UniqueAddressStat";
import {initCfxSdk} from "./service/common/utils";
import {StatApp} from "./StatApp";
import {IS_EVM2, KV} from "./model/KV";
import {TokenTool} from "./service/tool/TokenTool";
import {QuoteSync} from "./service/QuoteSync";
import {repeatCheckAccount} from "./service/watcher/AccountChecker";

async function main() {
    redirectLog()
    regExitHook()
    // init firstly
    const config = await init()
    const cfx = await initCfxSdk(config.conflux, 'StatTask');
    StatApp.networkId = cfx.networkId;
    StatApp.isEVM = await KV.getSwitch(IS_EVM2);
    // startSync3525('useConfigRpc', "-1", "10000").then()
    startContractUserAnd1155data(cfx, config, 500).then();
    startUniqueAddrStat(cfx).then()
    repeatCheckAccount(cfx).then(); // should move it to stat-task
    // quote service
    if (config?.syncQuote?.open) {
        const tokenTool = new TokenTool(cfx);
        const quoteSync = new QuoteSync({cfx, config, tokenTool})
        await quoteSync.schedule()
    }
    console.log(`\n${__filename} started.\n`)
}

if (module === require.main) {
    main().then()
}
