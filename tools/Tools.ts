import {ConfigInstance, loadConfig} from "../stat/config/StatConfig";
import {dingMsg} from "../stat/monitor/Monitor";
import {getHardwareInfo, monitorHardware} from "../stat/monitor/hardware";

export default {}

async function main() {
	const [,,cmd, arg1 , arg2] = process.argv;
	const cfg = loadConfig('Prod');
	if (cmd === 'ding') {
		await dingMsg(`test ding, possible keywords are: cfx, alert scan. arg1: [${arg1}]`, ConfigInstance.dingTalkToken)
	} else if (cmd === 'ding-dev') {
		await dingMsg(`test ding, possible keywords are: cfx, alert scan. arg1: [${arg1}]`, ConfigInstance.dingDevToken)
	} else if (cmd === 'hardware') {
		let forceAlert = Boolean(arg1);
		monitorHardware(msg=>{
			dingMsg(ConfigInstance.dingDevToken, msg);
			forceAlert = false;
		},true, forceAlert)
		setInterval(main, 5_000);
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
