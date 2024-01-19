const {app} = require('./index')
const {ApiApp} = require('./app')
const {init: initStatApp} = require('../stat/Index')
const {KV} = require('../stat/model/KV')

async function main() {
    console.log(`----- start stat and scan-api -----`)
    process.env['unified_mod'] = 'yes';
    await initStatApp();
    console.log(`--- start scan-api ---`)
    ApiApp.injectContext(KV.sequelize)
    return app.start()
}

if (require.main === module) {
    main().then()
}
