require('../stat/test/benchmark.js')
import {Conflux, format} from "js-conflux-sdk";
import {formatTrace, initCfxSdk} from "../stat/service/common/utils";
import {FullBlockService} from "../stat/service/FullBlockService";
import {init} from "../stat/service/tool/FixDailyTokenStat";
import {ConfluxOption} from "../stat/config/StatConfig";

let context = {
	epoch: 0,
	round: 0,
	blockCount: 0, txCount: 0, eventCount: 0, traceCount: 0,
}

async function doIt(cfx: Conflux, workerId: number) {
	while (true) {
		context.round --;
		if (context.round < 0) {
			break
		}
		let epoch = context.epoch ++;
		const hashArr = await cfx.getBlocksByEpochNumber(epoch);
		const p = hashArr[hashArr.length-1];

		const blockInfoArr = await Promise.all(hashArr.map(hash=>{
			return cfx.getBlockByHashWithPivotAssumption(hash, p, epoch);
		}))

		const traceInfoArr = await Promise.all(hashArr.map(hash=>{
			return cfx.traceBlock(hash);
		}))
		traceInfoArr.forEach(t=>{
			t["transactionTraces"].forEach(tt=>{
				context.traceCount += tt.traces.length
			})
		});

		const r2d = await cfx.getEpochReceiptsByPivotBlockHash(p)
		r2d.forEach(rr=>{
			rr.forEach(r=>{
				if (r.outcomeStatus == 1 || r.outcomeStatus == 0) {
					context.txCount ++;
				}
			})
		})
		context.blockCount += hashArr.length;
	}
}

export async function rpcLoadTest(url: string, start = 1, threads: number=8, round = 1000) {
	const cfx = await initCfxSdk({url});
	console.log(`network `, cfx.networkId);
	console.log(`worker ${threads} round ${round} from epoch ${start}`)

	context.epoch = start;
	context.round = round;
	const begin = Date.now();
	const workers = []
	for (let i = 0; i < threads; i++) {
		workers.push(doIt(cfx, i));
	}
	await Promise.all(workers);
	const elapse = Date.now() - begin;
	console.log(`it took ${elapse/1000}s , average ${elapse/round}ms per epoch , block ${
		context.blockCount} TX ${context.txCount} event ${context.eventCount} trace ${context.traceCount}`)
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

async function rpcBenchmark() {
	const [,,cmd, cntStr, url = "http://main.confluxrpc.com", blockHash, threads] = process.argv;
	console.log(`rpc is ${url}`)
	const _cfxR = await initCfxSdk({url} as ConfluxOption);
	const blockTrace = await _cfxR.traceBlock(blockHash || "0x8045a12730c4fc7527ecf1ed3788015e00065d6ad96fa0019d97ccf99b8a5a02")
	console.log(`trace of block :`, blockTrace)
	const obj = JSON.parse(JSON.stringify(blockTrace));
	let start = Date.now()
	let i = 0;
	let times = parseInt(cntStr)
	while (i < times) {
		// formatTrace(obj)
		format['blockTraces'](obj);
		// console.log(`that is `, v)
		i++
	}
	let cost = Date.now() - start
	const reCreatedV = format['blockTraces'](obj);
	console.log(`\n created trace:`, reCreatedV);
	console.log(`format trace : run ${times} times , cost ${cost}ms, avg ${cost/times}`)
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
	const [,,cmd, url, start = "1", threads = "8", round = "1000"] = process.argv;
	if ('rpcLoadTest' === cmd) {
		await rpcLoadTest(url, parseInt(start), parseInt(threads), parseInt(round));
	} else if ('rpcBenchmark' === cmd) {
		await rpcBenchmark();
	} else if ('rpcCacheTest' === cmd) {
		await rpcCacheTest()
	} else if ('fetchDataTest' === cmd) {
		await fetchDataTest(parseInt(start||"1"));
	}
}

if (module == require.main) {
	main().then()
}

// node tools/rpcLoadTest.js rpcLoadTest http:// 100 16 10000
// node tools/rpcLoadTest.js rpcCacheTest http://127.0.0.1:12537
// node tools/rpcLoadTest.js rpcBenchmark 1000 http://main.confluxrpc.com
// node tools/rpcLoadTest.js rpcBenchmark 1000 http://172.16.2.240:12569

// node tools/rpcLoadTest.js rpcLoadTest http://172.16.2.240:12569 1 8 10000
// node tools/rpcLoadTest.js rpcLoadTest http://172.16.3.16:12537 1 8 10000
