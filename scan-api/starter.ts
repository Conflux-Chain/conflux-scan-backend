const {scheduleSwaggerReporter} = require("../stat/monitor/swaggerMetrics");

const {app} = require('./index')
const {ApiApp} = require('./app')
const {init: initStatApp} = require('../stat/Index')
const {KV} = require('../stat/model/KV')

async function main() {
    console.log(`----- start stat and scan-api -----`)
    process.env['unified_mod'] = 'yes';
    await initStatApp();
    console.log(`--- start scan-api ---`)
    ApiApp.injectContext(KV.sequelize);
    const {ConfigInstance} =require("../stat/config/StatConfig");
    if (!ConfigInstance.v1port) {
        ConfigInstance.v1port = app.config.port;
    }
    await scheduleSwaggerReporter(ConfigInstance);
    return app.start()
}

if (require.main === module) {
    main().then()
}
