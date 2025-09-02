import {init as initStatApp} from "../stat/Index";
import {KV} from "../stat/model/KV";
import {app} from "./index";
import {scheduleSwaggerReporter} from "../stat/monitor/swaggerMetrics";
import {ApiApp} from "./app";
import {ConfigInstance} from "../stat/config/StatConfig";

export {} // placeholder

function shouldNotHaveDifferentConfig(name: string, v1?: string|number, v2?: string) {
    if (v1 && v2 && v1 != v2) {
        console.log(`there are two different config for ${name} : [${v1}] and [${v2}]`);
        process.exit(1);
    }
}

async function main() {
    console.log(`----- start stat and scan-api -----`)
    process.env['unified_mod'] = 'yes';
    const statApp = await initStatApp();
    console.log(`--- start scan-api ---`)
    ApiApp.injectContext(KV.sequelize);

    shouldNotHaveDifferentConfig("v1port", ConfigInstance.v1port, app.config.port);
    shouldNotHaveDifferentConfig("contractVerificationUrl", ConfigInstance.contractVerificationUrl, app.config.contractVerificationUrl);

    // uniform config
    ConfigInstance.v1port = app.config.port = ConfigInstance.v1port || app.config.port;

    ConfigInstance.contractVerificationUrl = app.config.contractVerificationUrl
        = ConfigInstance.contractVerificationUrl || app.config.contractVerificationUrl;

    await scheduleSwaggerReporter(ConfigInstance, ConfigInstance.v1port);

    return app.start()
}

if (require.main === module) {
    main().then()
}
