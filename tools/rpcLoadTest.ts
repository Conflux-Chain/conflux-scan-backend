import {Conflux} from "js-conflux-sdk";
import {initCfxSdk} from "../stat/service/common/utils";
import {FullBlockService} from "../stat/service/FullBlockService";
import {init} from "../stat/service/tool/FixDailyTokenStat";

async function doIt(cfx: Conflux, workerId: number, start: number, step: number) {
	let round = 0;
	let totalMs = 0;
	let eCnt = 0;
	while (true) {
		const startT = Date.now();
		const hashArr = await cfx.getBlocksByEpochNumber(start);
		const p = hashArr[hashArr.length-1];
		const blockInfoArr = await Promise.all(hashArr.map(hash=>{
			return cfx.getBlockByHashWithPivotAssumption(hash, p, start);
		}))
		const blockTime = new Date(blockInfoArr[blockInfoArr.length-1].timestamp*1000);
		await cfx.getEpochReceiptsByPivotBlockHash(p).catch(e=>{
			if (e.message === 'block_number is missing for best_hash') {
				eCnt ++;
			} else {
				throw e;
			}
		});
		totalMs += Date.now() - startT;
		start += step;
		round++;
		if (round % 100 == 1) {
			console.log(`worker ${workerId} round ${round} position ${start} time ${blockTime.toISOString()} error ${eCnt} avg ms ${Math.round(totalMs / round)}`);
		}
	}
}

export async function rpcLoadTest(url: string, start = 1, threads: number=8) {
	const cfx = await initCfxSdk({url});
	console.log(`network `, cfx.networkId);
	for (let i = 0; i < threads; i++) {
		doIt(cfx, i, start+i, threads).then();
	}
}

async function fetchDataTest(start: number) {
	const cfg = await init();
	const cfx = await initCfxSdk(cfg.conflux);
	const svc = new FullBlockService(cfx);
	await svc.updateEpochNumber();
	let ms = 0;
	let cnt = 0;
	while(true) {
		const data = await svc.loadEpochData(start++);
		cnt ++;
		ms += data.rpcTime;
		if (cnt % 100 == 0) {
			console.log(`ms ${ms} epoch ${start}`);
			ms = 0;
		}
	}
}

async function main() {
	const [,,cmd, url, start, threads] = process.argv;
	if ('rpcLoadTest' === cmd) {
		await rpcLoadTest(url, parseInt(start||"1"), parseInt(threads||"8"));
	} else if ('fetchDataTest' === cmd) {
		await fetchDataTest(parseInt(start||"1"));
	}
}

if (module == require.main) {
	main().then()
}

// node tools/rpcLoadTest.js rpcLoadTest http:// 100 16
