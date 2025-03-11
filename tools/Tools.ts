import {ConfigInstance, loadConfig} from "../stat/config/StatConfig";
import {dingMsg} from "../stat/monitor/Monitor";

export default {}

async function main() {
	const [,,cmd, arg1 , arg2] = process.argv;
	const cfg = loadConfig('Prod');
	if (cmd === 'ding') {
		await dingMsg(`test ding, possible keywords are: cfx, alert scan. arg1: [${arg1}]`, ConfigInstance.dingTalkToken)
	} else {
		console.log(`nothing [${cmd}]`)
	}
}

if (module == require.main) {
	main().then()
}

// node tools/Tools.js ding
