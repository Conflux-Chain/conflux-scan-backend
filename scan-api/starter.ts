import {init as initStatApp} from "../stat/Index";
import {KV} from "../stat/model/KV";
import {app} from "./index";
import {scheduleSwaggerReporter} from "../stat/monitor/swaggerMetrics";
import {ApiApp} from "./app";
import {ConfigInstance} from "../stat/config/StatConfig";
import {repeatCheckAccount} from "../stat/service/watcher/AccountChecker";

export {} // placeholder

async function main() {
    console.log(`----- start stat and scan-api -----`)
    process.env['unified_mod'] = 'yes';
    const statApp = await initStatApp();
    console.log(`--- start scan-api ---`)
    ApiApp.injectContext(KV.sequelize);
    if (!ConfigInstance.v1port) {
        ConfigInstance.v1port = app.config.port;
    }
    await scheduleSwaggerReporter(ConfigInstance, ConfigInstance.v1port);
    repeatCheckAccount(statApp.cfx).then(); // should move it to stat-task
    return app.start()
}

if (require.main === module) {
    main().then()
}
