import * as Router from "koa-router";
import {StatApp} from "../StatApp";
import {ConfigInstance} from "../config/StatConfig";
import {getAppEntryName} from "../config/LoggerConfig";
import {IS_EVM2, KV} from "../model/KV";

const Koa = require('koa');

export const appPorts = {
	block:              6001,
	epoch:              6002,
	token_transfer:     6003,
	token_x:            6004,
	cfx_transfer:       6005,
	pos:                6006, // core space only
	stat_task:          6007,
	nft_meta:           6008,
	prune:              6009,
	// e-space uses these ports in style 5xxx.
}
export let evmDiffPort = -1000;
export async function listenPort(app: string) {
	let port = appPorts[app];
	if (!port) {
		console.log(`Port not found, app [${app}]`);
		return;
	}
	if (ConfigInstance.diffMonitorPort === -9000) {
		return;
	}
	const isEVM = await KV.getSwitch(IS_EVM2);
	if (isEVM) {
		port += ConfigInstance.diffMonitorPort ?? evmDiffPort;
	}
	const router = new Router({ prefix: `/${app}` });
	regApi(router, app, isEVM);
	const web = new Koa();
	web.use(async (ctx, next) => {
		try {
			await next();
		} catch (e) {
			console.log(`failed to serve ${ctx.path}: `, e);
			ctx.body = {error: e};
		}
	})
	web.use(router.routes());
	console.log(`Listening on ${port} , app ${app}`);
	web.listen(port);
}

function regApi(router: Router, app: string, isEVM: boolean) {
	router.get('/', (ctx, next) => {
		ctx.body = {app, server: ConfigInstance.serverTag, net: StatApp.networkId, entry: getAppEntryName(), isEVM}
	})
}
const superagent = require('superagent');
export async function checkAllPort(evm: boolean) {
	console.log(`check all port: evm ? ${evm}`);
	for(const app of Object.keys(appPorts)) {
		let p = appPorts[app];
		if (evm) {
			p += evmDiffPort;
		}
		await superagent.get(`http://127.0.0.1:${p}/${app}`).then(res=>res.body).then((res) => {
			console.log(`${app} port ${p} -> `, res)
		}).catch(err=>{
			console.log(`${app} port ${p} -> ${err}`);
		});
	}
}
