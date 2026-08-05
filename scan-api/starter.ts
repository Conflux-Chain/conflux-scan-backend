import * as path from "path";
import { init as initStatApp, start as startStatApp } from "../stat/Index";
import { init as initScanAPI, start as startScanAPI } from "./index";
import { addSwaggerDoc, initSwaggerStatsOnce } from "./router/middleware";

export {} // placeholder

async function main() {
    const { statKoa, statApp } = await initStatApp();
    const koa = await initScanAPI();

    addSwaggerDoc(statKoa, '/stat', path.resolve(__dirname, '../document/stat-priv-api.yaml'));
    addSwaggerDoc(koa, '/v1', path.resolve(__dirname, '../document/priv-api.yaml'));
    initSwaggerStatsOnce([statKoa, koa], { uriPath: '/v1/api-stat' });

    await startStatApp(statKoa, statApp);
    await startScanAPI(koa);
}

if (require.main === module) {
    main().then()
}
