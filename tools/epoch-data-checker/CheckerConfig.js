"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCheckerConfig = void 0;
const StatConfig_1 = require("../../stat/config/StatConfig");
function loadCheckerConfig() {
    // Keep the same config precedence as the stat containers.  The checker does
    // not create or start any container; it only reuses their RPC and DB config.
    return StatConfig_1.loadConfig('Prod');
}
exports.loadCheckerConfig = loadCheckerConfig;
