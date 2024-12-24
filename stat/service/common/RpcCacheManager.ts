import {FullBlock, loadMaxBlockEpoch} from "../../model/FullBlock";
import {CLEAN_CACHE_CURSOR, KV} from "../../model/KV";
import * as fs from "fs";
import {init} from "../tool/FixDailyTokenStat";
import {EpochHashCfxTransfer} from "../../CfxTransferSync";
import {EpochHashTokenTransfer} from "../../TokenTransferSync";
import {Epoch} from "../../model/Epoch";

function rmFile(path: string, showLog: boolean) {
	try {
		fs.rmSync(path)
		showLog && console.log(`rm cache ${path}`)
	} catch (e) {
		showLog && console.log(`failed to remove ${path} , ${e}`)
	}
}

export async function rmCache(cacheDir: string, cursor: number, showLog: boolean) {
	if (!cacheDir) {
		return
	}
	for (const method of ['cfx_getBlocksByEpoch', 'cfx_getEpochReceipts']) {
		const path = `${cacheDir}/${method}_${cursor}.json`;
		rmFile(path, showLog);
	}

	const blockList = await FullBlock.findAll({attributes: ['hash'], where: {epoch: cursor}, raw: true})
	for(const {hash} of blockList) {
		rmFile(`${cacheDir}/cfx_getBlockByHash_${hash}_true.json`, showLog)
		rmFile(`${cacheDir}/trace_block_${hash}.json`, showLog)
	}
}

export async function evictCache(keepEpochs: number, cacheDir: string) {
	const maxBlockEpoch = await loadMaxBlockEpoch(NaN)
	if (isNaN(maxBlockEpoch)) {
		return;
	}
	let bottomEpoch = maxBlockEpoch - keepEpochs;
	if (keepEpochs == 0) {
		const tasks = [FullBlock, EpochHashCfxTransfer, EpochHashTokenTransfer, Epoch].map(
			// @ts-ignore
			m=>m.findOne({order:[['epoch', 'desc']]}).then(res=>res?.epoch || 0)
		)
		const epochArr = await Promise.all(tasks)
		// @ts-ignore
		bottomEpoch = Math.min(epochArr)
	}
	// remove caches with epoch < bottomEpoch
	let cursor = await KV.getNumber(CLEAN_CACHE_CURSOR, bottomEpoch - keepEpochs);
	if (cursor < 0) {
		return;
	}
	cursor ++;

	let round = 0;
	while (cursor < bottomEpoch) {
		const showLog = round % DefaultCacheConf.logPeriod == 0;
		await rmCache(cacheDir, cursor, showLog);
		await KV.saveNumber(CLEAN_CACHE_CURSOR, cursor, undefined)
		cursor ++;
		round ++;
	}
}
export const DefaultCacheConf = {
	keepEpochs: 0,
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
