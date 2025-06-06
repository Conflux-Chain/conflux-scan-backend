import {ConfigInstance, loadConfig} from "../stat/config/StatConfig";
import {dingMsg} from "../stat/monitor/Monitor";
import {getHardwareInfo, monitorHardware} from "../stat/monitor/hardware";
import {StatApp} from "../stat/StatApp";
import {checkAllPort} from "../stat/monitor/serverApi";

export default {}

function monitorHD(forceAlert: boolean = false) {
	monitorHardware(msg => {
		dingMsg(msg, ConfigInstance.dingDevToken);
	}, true, forceAlert)
}

async function main() {
	StatApp.networkId = 0;
	const [,,cmd, arg1 , arg2] = process.argv;
	const cfg = loadConfig('Prod');
	if (cmd === 'ding') {
		await dingMsg(`test ding, possible keywords are: cfx, alert scan. arg1: [${arg1}]`, ConfigInstance.dingTalkToken)
	} else if (cmd === 'ding-dev') {
		await dingMsg(`test ding, possible keywords are: cfx, alert scan. arg1: [${arg1}]`, ConfigInstance.dingDevToken)
	} else if (cmd === 'check-ports') {
		await checkAllPort(arg1 === 'evm');
	} else if (cmd === 'hardware') {
		let forceAlert = Boolean(arg1);
		monitorHD(forceAlert);
		setInterval(monitorHD, 5_000);
	} else {
		console.log(`nothing [${cmd}]`);
	}
}

if (module == require.main) {
	main().then()
}

// node tools/Tools.js ding
// node tools/Tools.js ding-dev
// node tools/Tools.js hardware
// node tools/Tools.js check-ports [evm]
