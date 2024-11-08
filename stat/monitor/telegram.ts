import {ConfigInstance, loadConfig} from "../config/StatConfig";

const superagent = require('superagent');

export async function sendAlertTg(msg: string) {
	return sendTextTG({message: msg, token: ConfigInstance?.tgToken, chatId: ConfigInstance?.tgChatId})
}

async function sendTextTG({message = '', token='', chatId = ''}) {
	if (!token || !chatId) {
		console.log(`telegram not set. want send: ${message}`);
		return;
	}
	const url = `https://api.telegram.org/bot${token}/sendMessage`;
	const body = await superagent.post(url).send({
		chat_id: chatId, text: message,
	}).then(res=>res.body);
	console.log(`send tg msg result `, body);
}


/*
curl -X POST \
     -H 'Content-Type: application/json' \
     -d '{"chat_id": "123456789", "text": "This is a test from curl", "disable_notification": true}' \
     https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage
 */
async function getUpdates(TELEGRAM_BOT_TOKEN: string) {
	const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`;
	const body = await superagent.get(url).then(res=>res.body);
	console.log(`get updates`, body)
}

async function main() {
	const [,,cmd,arg1, arg2] = process.argv;
	if (cmd == 'up') {
		await getUpdates(arg1);
	} else if (cmd == 'msg') {
		let token = arg1;
		if (arg1 == 'cfg') {
			const cfg = loadConfig('Prod');
			await sendAlertTg(`test tg channel\nok\nfrom machine ${cfg.serverTag}`)
			return
		}
		const chatId = arg2;
		await sendTextTG({message: 'test tg message', token, chatId})
	} else {
		console.log(`cmd is ${cmd}`);
	}
}

if (module == require.main) {
	main().then()
}

// node stat/monitor/telegram msg token chatId
