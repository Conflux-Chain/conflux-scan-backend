import {Conflux} from "js-conflux-sdk";
import {initCfxSdk} from "../stat/service/common/utils";
import {FullBlockService} from "../stat/service/FullBlockService";
import {init} from "../stat/service/tool/FixDailyTokenStat";
import {ConfluxOption} from "../stat/config/StatConfig";

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

async function rpcCacheTest() {
	const [,,cmd, url, cachePath = './cache/rpc', threads] = process.argv;
	console.log(`cache path [${cachePath}]`);
	const _cfxW = await initCfxSdk({url, cachePath, writeCache: true, writeTraceCache: true} as ConfluxOption);
	const _cfxR = await initCfxSdk({url, cachePath, readCache:true,   readTraceCache: true} as ConfluxOption);
	const epochNumber = 8;

	async function read(cfx: Conflux) {
		const arr = await cfx.getBlocksByEpochNumber(epochNumber);
		console.log(`arr length ${arr.length} `)
		const pHash = arr[arr.length-1];
		for (let hash of arr) {
			const block = await cfx.getBlockByHash(hash);
			const block1 = await cfx.getBlockByHash(hash, true);
			const block2 = await cfx.getBlockByHashWithPivotAssumption(hash, pHash, epochNumber);
			const traces = await cfx.traceBlock(hash);
			console.log(`block ${[block.hash,block1.hash, block2.hash].map(s=>s.substring(0, 6)).join(' ')} traces ${traces}`)
		}
		const rcptArr = await cfx.getEpochReceiptsByPivotBlockHash(pHash);
		console.log(`receipts arr length ${rcptArr.length}`)
	}

	console.log(`write cache`)
	await read(_cfxW); // should write cache
	console.log(`\nread cache`)
	await read(_cfxR); // should read cache

	console.log(`ok`)
}

async function main() {
	const [,,cmd, url, start, threads] = process.argv;
	if ('rpcLoadTest' === cmd) {
		await rpcLoadTest(url, parseInt(start||"1"), parseInt(threads||"8"));
	} else if ('rpcCacheTest' === cmd) {
		await rpcCacheTest()
	} else if ('fetchDataTest' === cmd) {
		await fetchDataTest(parseInt(start||"1"));
	}
}

if (module == require.main) {
	main().then()
}

// node tools/rpcLoadTest.js rpcLoadTest http:// 100 16
// node tools/rpcLoadTest.js rpcCacheTest http://127.0.0.1:12537
