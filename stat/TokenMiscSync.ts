import {redirectLog} from "./service/tool/LoggerConfig";
import {regExitHook} from "./service/tool/ProcessTool";
import {startContractUserAnd1155data} from "./service/watcher/BatchBalanceWatcher";
import { init } from "./service/tool/FixDailyTokenStat";
import {startUniqueAddrStat} from "./service/UniqueAddressStat";
import {initCfxSdk} from "./service/common/utils";
import {StatApp} from "./StatApp";
import {IS_EVM2, KV} from "./model/KV";
import {repeatCheckAccount} from "./service/watcher/AccountChecker";
import {listenPort} from "./monitor/serverApi";

async function main() {
    redirectLog()
    regExitHook()

    const config = await init()
    const cfx = await initCfxSdk(config.conflux, 'TokenMisc');
    StatApp.networkId = cfx.networkId;
    StatApp.isEVM = await KV.getSwitch(IS_EVM2);

    startContractUserAnd1155data(cfx, config, 500).then();
    startUniqueAddrStat().then()
    repeatCheckAccount(cfx).then(); // should move it to stat-task
    console.log(`\n${__filename} started.\n`)
}

if (module === require.main) {
    main().then(()=>listenPort('token_x'))
}
