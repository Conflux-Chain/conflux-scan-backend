import {redirectLog} from "./config/LoggerConfig";
import {regExitHook} from "./service/tool/ProcessTool";
import {startSync3525} from "./T3525Sync";
import {startBalanceTask} from "./service/watcher/BatchBalanceWatcher";
import { init } from "./service/tool/FixDailyTokenStat";

async function main() {
    redirectLog()
    regExitHook()
    // init firstly
    await init()
    await startSync3525('useConfigRpc', "-1", "10000")
    await startBalanceTask("", "useConfigRpc", "500")
}

if (module === require.main) {
    main().then()
}
