import {init as initStatApp} from "../stat/Index";
import {init as initScanAPI} from "./index";

export {} // placeholder

async function main() {
    await initStatApp();
    await initScanAPI();
}

if (require.main === module) {
    main().then()
}
