import {FullTransaction} from "../stat/model/FullBlock";
import {Op} from "sequelize";
import {TransactionReceipt} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {regExitHook, sleep} from "../stat/service/tool/ProcessTool";
import {Conflux} from "js-conflux-sdk";
import {init} from "../stat/service/tool/FixDailyTokenStat";
import {initCfxSdk} from "../stat/service/common/utils";
import * as fs from "fs";

const PROGRESS_FILE = "/tmp/fixTxGas-epoch.txt";

class DataEntry {
	id: number;
	epoch: number;
	tx: FullTransaction[];
	txReady?: boolean; // this a sinal indicates tx array is ready

	receipts: TransactionReceipt[][]
}

class Context {
	txMap: Map<number, DataEntry> = new Map();

	testMode: boolean = false;
	sameFeeCount: number = 0;
	diffFeeCount: number = 0;

	logCounter: number = 0;
	processedEpochCount: number = 0;
}

async function main() {
	const args = process.argv.slice(2);
	const cmd = args.find(v => v === "test");
	const argEpochMaxInclude = args.find(v => /^\d+$/.test(v));

	const cfg = await init()
	let cfx: Conflux = await initCfxSdk(cfg.conflux);
	let epochMaxInclude = await cfx.getEpochNumber();

	const savedEpochMaxInclude = loadSavedEpochMaxInclude();
	const parsedArgEpochMaxInclude = parseEpoch(argEpochMaxInclude);

	if (savedEpochMaxInclude !== null) {
		epochMaxInclude = Math.min(epochMaxInclude, savedEpochMaxInclude);
	}

	if (parsedArgEpochMaxInclude !== null) {
		epochMaxInclude = Math.min(epochMaxInclude, parsedArgEpochMaxInclude);
	}

	console.log(`use epochMaxInclude ${epochMaxInclude}, arg ${parsedArgEpochMaxInclude}, saved ${savedEpochMaxInclude}`);

	const ctx = new Context();

	if (cmd === 'test') {
		ctx.testMode = true;
	}

	loadTxTask(epochMaxInclude, ctx.txMap, 100);
	loadReceiptTask(ctx, cfx)
	updateGas(ctx)

	regExitHook()
}

function parseEpoch(v: string | undefined): number | null {
	if (!v) {
		return null;
	}
	const parsed = Number(v);
	if (!Number.isInteger(parsed) || parsed < 0) {
		return null;
	}
	return parsed;
}

function loadSavedEpochMaxInclude(): number | null {
	if (!fs.existsSync(PROGRESS_FILE)) {
		return null;
	}
	const value = fs.readFileSync(PROGRESS_FILE, "utf8").trim();
	const parsed = parseEpoch(value);
	if (parsed === null) {
		console.log(`invalid progress in ${PROGRESS_FILE}: ${value}`);
		return null;
	}
	return parsed;
}

function saveEpochProgress(epoch: number): void {
	fs.writeFileSync(PROGRESS_FILE, `${epoch}\n`);
}

function clearEpochProgress(): void {
	if (fs.existsSync(PROGRESS_FILE)) {
		fs.unlinkSync(PROGRESS_FILE);
	}
}

function fatal() {
	process.exit(1);
}

async function updateGas(ctx: Context): Promise<void> {
	let id = 0;
	while (true) {
		const de = ctx.txMap.get(id);

		if (de?.id < 0) {
			break
		}

		if (!de?.receipts?.length) {
			console.log(`receipt is not ready. id ${id}`)
			await sleep(1000);
			continue
		}

		ctx.txMap.delete(id);
		id ++;
		ctx.processedEpochCount++;

		if (ctx.processedEpochCount % 1000 === 0) {
			saveEpochProgress(de.epoch);
		}

		const dbTxByHash = new Map<string, FullTransaction>();
		de.tx.forEach((transaction) => {
			dbTxByHash.set(transaction.hash, transaction);
		})

		for(const arrOfBlock of de.receipts) {
			for (const rcpt of arrOfBlock) {
				if (rcpt.outcomeStatus != 0 || rcpt.epochNumber !== de.epoch
					// crossing space tx
					|| rcpt.gasFee == 0) {
					if (ctx.testMode) {
						console.log(`skip tx status ${rcpt.outcomeStatus}  gasFee ${rcpt.gasFee} epoch ${rcpt.epochNumber}`);
					}
					continue;
				}
				// tx
				const dbTx = dbTxByHash.get(rcpt.transactionHash);
				if (!dbTx) {
					console.log(`db tx is missing, epoch ${rcpt.epochNumber} , hash ${rcpt.transactionHash}`)
					console.log(`db tx , there are:\n`, [...dbTxByHash.keys()].join('\n'));
					rcpt.logs = rcpt.logsBloom = undefined; // remove long data before logging
					console.log(`receipt detail:\n`, rcpt)
					fatal()
				}
				dbTxByHash.delete(rcpt.transactionHash);

				// if (ctx.logCounter % 1000 === 0) {
				// 	console.log(`db gas: ${dbTx.gas} , receipt gas fee ${rcpt.gasFee} , tx ${rcpt.transactionHash}`);
				// }
				ctx.logCounter ++;

				if (dbTx.gas == rcpt.gasFee) {
					ctx.sameFeeCount ++;
				} else if (ctx.testMode) {
					ctx.diffFeeCount++;
					console.log(`diff ! db ${dbTx.gas} vs ${rcpt.gasFee} receipt , tx ${rcpt.transactionHash}`);
				} else {
					ctx.diffFeeCount++;
					await FullTransaction.update({
						gas: rcpt.gasFee,
					}, {
						where: {epoch: rcpt.epochNumber, hash: rcpt.transactionHash},
						logging: ctx.testMode ? console.log : false,
						limit: 1,
					});
				}
				if (ctx.logCounter % 1000 === 1) {
					console.log(`epoch ${de.epoch} , sameFeeCount ${ctx.sameFeeCount} diffFeeCount ${ctx.diffFeeCount}`);
				}
			}
		}

		if (dbTxByHash.size > 0) {
			console.log(`db tx remains, there are:\n`, [...dbTxByHash.keys()].join('\n'));
			fatal();
		}
	}

	clearEpochProgress();
}

async function loadReceiptTask(ctx:Context, cfx:Conflux) {
	const txMap = ctx.txMap;
	let id = 0;
	while (true) {
		const de = txMap.get(id);

		if (de?.id < 0) {
			break
		}

		if (!de?.txReady) {
			console.log(`db tx is not ready. id ${id}`)
			await sleep(1000);
			continue
		}

		const rr = await cfx.getEpochReceipts(de.epoch).catch(e => {
			console.log(`failed to load receipts for ${de.epoch}: ${e}`);
			return null;
		});
		if (!rr) {
			await sleep(3000);
			continue;
		}
		de.receipts = rr
		id++
	}
}


async function loadTxTask(epochMaxInclude: number, map: Map<number, DataEntry>, mapSize: number) {
	let id = 0;
	while (true) {
		if (map.size >= mapSize) {
			console.log(`tx pool is full. id ${id}`)
			await sleep(1000);
			continue;
		}
		const {list, nextEpoch} = await loadTx(epochMaxInclude, mapSize)
		if (nextEpoch === 0) {
			break;
		}
		let useDataEntry: DataEntry = null;
		list.forEach(entry => {
			if (!useDataEntry || useDataEntry.epoch !== entry.epoch) {
				useDataEntry && (useDataEntry.txReady = true);

				useDataEntry = {
					id: id++, epoch: entry.epoch, tx: [], receipts: [],
				}
				map.set(useDataEntry.id, useDataEntry);
			}
			useDataEntry.tx.push(entry);
		})
		useDataEntry && (useDataEntry.txReady = true);

		epochMaxInclude = nextEpoch
	}
	// indicates stop
	map.set(id++, {epoch: 0, id: -1, receipts: [], tx: []})
}

async function loadTx(epochMaxInclude: number, limit: number) {
	const all = await FullTransaction.findAll({
		attributes: ['epoch', 'hash', 'gas'],
		where: {epoch: {[Op.lte]: epochMaxInclude}, status: 0, gas: {[Op.ne]: 0}},
		order: [['epoch', 'desc'], ['blockPosition', 'desc'], ['txPosition', 'desc']],
		limit
	});
	if (!all.length) {
		console.log(`no transaction found, epoch <= ${epochMaxInclude}`);
		return {list: [], nextEpoch: 0};
	}
	// drop tail records, they may be incomplete of an epoch
	const last = all[all.length - 1];
	const list = all.filter(row => row.epoch > last.epoch);
	return {list, nextEpoch: last.epoch};
}


if (module == require.main) {
	main()
}

// node tools/FixTxGasFee.js [test] [epochMaxInclude]
