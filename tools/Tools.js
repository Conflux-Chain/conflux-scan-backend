"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const StatConfig_1 = require("../stat/config/StatConfig");
const Monitor_1 = require("../stat/monitor/Monitor");
const TokenTool_1 = require("../stat/service/tool/TokenTool");
const utils_1 = require("../stat/service/common/utils");
const hardware_1 = require("../stat/monitor/hardware");
const StatApp_1 = require("../stat/StatApp");
const serverApi_1 = require("../stat/monitor/serverApi");
exports.default = {};
function monitorHD(forceAlert = false) {
    (0, hardware_1.monitorHardware)(msg => {
        (0, Monitor_1.dingMsg)(msg, StatConfig_1.ConfigInstance.dingDevToken);
    }, true, forceAlert);
}
async function main() {
    StatApp_1.StatApp.networkId = 0;
    const [, , cmd, arg1, arg2] = process.argv;
    const cfg = (0, StatConfig_1.loadConfig)('Prod');
    if (cmd === 'ding') {
        await (0, Monitor_1.dingMsg)(`test ding, possible keywords are: cfx, alert scan. arg1: [${arg1}]`, StatConfig_1.ConfigInstance.dingTalkToken);
    }
    else if (cmd === 'ding-dev') {
        await (0, Monitor_1.dingMsg)(`test ding, possible keywords are: cfx, alert scan. arg1: [${arg1}]`, StatConfig_1.ConfigInstance.dingDevToken);
    }
    else if (cmd === 'check-ports') {
        await (0, serverApi_1.checkAllPort)(arg1 === 'evm');
    }
    else if (cmd === 'hardware') {
        let forceAlert = Boolean(arg1);
        monitorHD(forceAlert);
        setInterval(monitorHD, 5000);
    }
    else if (cmd === 'decodeAnnouncement') {
        cfg.conflux.url = 'http://net8888cfx.confluxrpc.com';
        // let hash = '0xcdcc5a24474e627fca12f0a29d0f5cfcedac6d9337b8f933c11f559fad4a273c';
        let hash = '0xfe03325665a1b538f9763ec9f744954a2789e80a70b39a851d4b8854ed9cba46';
        const cfx = await (0, utils_1.initCfxSdk)(cfg.conflux);
        const tool = new TokenTool_1.TokenTool(cfx);
        const rcpt = await cfx.getTransactionReceipt(hash);
        for (const log of rcpt.logs) {
            let event = tool.decodeAnnouncePlus(log);
            console.log(`event `, event);
            if (!event) {
                continue;
            }
            const announce = event;
            const key = Buffer.from(announce.key, 'base64').toString();
            const decodedBase64 = Buffer.from(announce.value, 'base64').toString();
            console.log(`decoded base64: ${decodedBase64}`);
            console.log(`key: ${key}`);
            console.log(`raw value`, announce.value.toString());
        }
        const str = '["function workMyDirefulOwner(uint256,uint256)", "event Transfer(address indexed from, address indexed to, address value)"]';
        const b64 = Buffer.from(str).toString('base64');
        console.log(`b64: ${b64}`);
    }
    else {
        console.log(`nothing [${cmd}]`);
    }
}
if (module == require.main) {
    main().then();
}
// node tools/Tools.js ding
// node tools/Tools.js decodeAnnouncement
// node tools/Tools.js ding-dev
// node tools/Tools.js hardware
// node tools/Tools.js check-ports evm
