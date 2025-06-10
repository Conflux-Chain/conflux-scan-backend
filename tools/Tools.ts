import {ConfigInstance, loadConfig} from "../stat/config/StatConfig";
import {dingMsg} from "../stat/monitor/Monitor";
import {TokenTool} from "../stat/service/tool/TokenTool";
import {initCfxSdk} from "../stat/service/common/utils";
import {monitorHardware} from "../stat/monitor/hardware";
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
	} else if (cmd === 'decodeAnnouncement') {
		cfg.conflux.url = 'http://net8888cfx.confluxrpc.com';
		// let hash = '0xcdcc5a24474e627fca12f0a29d0f5cfcedac6d9337b8f933c11f559fad4a273c';
		let hash = '0xfe03325665a1b538f9763ec9f744954a2789e80a70b39a851d4b8854ed9cba46';
		const cfx = await initCfxSdk(cfg.conflux);
		const tool = new TokenTool(cfx);
		const rcpt = await cfx.getTransactionReceipt(hash)
		for (const log of rcpt.logs) {
			let event = tool.decodeAnnouncePlus(log);
			console.log(`event `, event);
			if (!event) {
				continue
			}
			const announce: any = event;
			const key = Buffer.from(announce.key, 'base64').toString();
			const decodedBase64 = Buffer.from(announce.value, 'base64').toString();
			console.log(`decoded base64: ${decodedBase64}`);
			console.log(`key: ${key}`);
			console.log(`raw value`, announce.value.toString());
		}
		const str = '["function workMyDirefulOwner(uint256,uint256)", "event Transfer(address indexed from, address indexed to, address value)"]';
		const b64 = Buffer.from(str).toString('base64');
		console.log(`b64: ${b64}`);
	} else {
		console.log(`nothing [${cmd}]`);
	}
}

if (module == require.main) {
	main().then()
}

// node tools/Tools.js ding
// node tools/Tools.js decodeAnnouncement
// node tools/Tools.js ding-dev
// node tools/Tools.js hardware
// node tools/Tools.js check-ports evm
