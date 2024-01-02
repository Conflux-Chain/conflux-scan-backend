import {redirectLog} from "./config/LoggerConfig";
import {regExitHook} from "./service/tool/ProcessTool";
import {startSync3525} from "./T3525Sync";
import {startBalanceTask} from "./service/watcher/BatchBalanceWatcher";
import { init } from "./service/tool/FixDailyTokenStat";
import {startApprovalSync} from "./ApprovalSync";

async function main() {
    redirectLog()
    regExitHook()
    // init firstly
    await init()
    startSync3525('useConfigRpc', "-1", "10000").then()
    startBalanceTask("", "useConfigRpc", "500").then()
    startApprovalSync().then()
    console.log(`\n${__filename} started.\n`)
}

if (module === require.main) {
    main().then()
}
