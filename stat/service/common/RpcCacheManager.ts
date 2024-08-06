import {FullBlock, loadMaxBlockEpoch} from "../../model/FullBlock";
import {CLEAN_CACHE_CURSOR, KV} from "../../model/KV";
import * as fs from "fs";
import {init} from "../tool/FixDailyTokenStat";

export async function evictCache(keepEpochs: number, cacheDir: string) {
	const maxBlockEpoch = await loadMaxBlockEpoch(NaN)
	if (isNaN(maxBlockEpoch)) {
		return;
	}
	const bottomEpoch = maxBlockEpoch - keepEpochs;
	// remove caches with epoch < bottomEpoch
	let cursor = await KV.getNumber(CLEAN_CACHE_CURSOR, bottomEpoch - keepEpochs);
	if (cursor < 0) {
		return;
	}
	cursor ++;
	function rmFile(path: string, showLog: boolean) {
		try {
			fs.rmSync(path)
			showLog && console.log(`rm cache ${path}`)
		} catch (e) {
			showLog && console.log(`failed to remove ${path} , ${e}`)
		}
	}
	let round = 0;
	while (cursor < bottomEpoch) {
		const showLog = round % DefaultCacheConf.logPeriod == 0;
		for (const method of ['cfx_getBlocksByEpoch', 'cfx_getEpochReceipts']) {
			const path = `${cacheDir}/${method}_${cursor}.json`;
			rmFile(path, showLog)
		}

		const blockList = await FullBlock.findAll({attributes: ['hash'], where: {epoch: cursor}, raw: true})
		for(const {hash} of blockList) {
			const path = `${cacheDir}/cfx_getBlockByHash_${hash}_true.json`;
			rmFile(path, showLog)
			rmFile(`${cacheDir}/trace_block_${hash}.json`, showLog)
		}

		await KV.saveNumber(CLEAN_CACHE_CURSOR, cursor, undefined)
		cursor ++;
		round ++;
	}
}
export const DefaultCacheConf = {
	keepEpochs: 10_000,
	cacheDir: "./cache/rpc",
	delaySec: 10,
	logPeriod: 100,
}

export async function startEvictCache(
	{keepEpochs, cacheDir, delaySec}
		= DefaultCacheConf
) {
	async function repeat() {
		try {
			await evictCache(keepEpochs, cacheDir)
		} catch (e) {
			console.log(`${__filename} evict cache error:`, e)
		}
		setTimeout(repeat, delaySec * 1000)
	}
	return repeat();
}

async function main() {
	const [,,cmd] = process.argv;
	await init();
	await startEvictCache()
}

if (module == require.main) {
	main().then()
}
