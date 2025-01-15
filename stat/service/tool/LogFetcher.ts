import {Conflux} from "js-conflux-sdk";
import {Log, TransactionReceipt} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {decodeTransferFromReceipts} from "../../TokenTransferSync";
import {TokenTool} from "./TokenTool";

import pLimit from "p-limit";
import {FullTransaction, loadMaxBlockEpoch} from "../../model/FullBlock";
import {sleep} from "./ProcessTool";
import {patchCfxGetLogs} from "../common/fastFormatter";

const limit = pLimit(100);

interface IJob {
	fromEpoch: number
	toEpoch: number
	range: number
}

class LogsJob {
	fromEpoch: number
	toEpoch: number
	range: number
	forked: boolean
	waitPre?: boolean

	beginMs: number;
	logs?: Promise<Log[]>
	result?: any;

	pre?: LogsJob
	next?: LogsJob

	constructor({fromEpoch, toEpoch, range}: IJob) {
		if (isNaN(toEpoch) || isNaN(range) || isNaN(fromEpoch)) {
			throw new Error(`bad params ${fromEpoch} , ${toEpoch} , ${range}`)
		}
		// console.log(`new job [${fromEpoch} , ${toEpoch}], ${range}`)
		this.fromEpoch = fromEpoch;
		this.toEpoch = toEpoch;
		this.range = range;
	}

	start(cfx: Conflux) {
		this.beginMs = Date.now();
		this.logs = cfx.getLogs({fromEpoch: this.fromEpoch, toEpoch: this.toEpoch});
	}
}

class LogsJobStream {
	head: LogsJob
	tail: LogsJob
	range: number
	dataSizeLimit: number
	rpcSizeLimit: number
	cfx: Conflux

	runningJob: LogsJob
	buildingJob: LogsJob

	constructor() {
	}

	start(from: number, range: number, jobCount: number, cfx: Conflux) {
		this.dataSizeLimit = 20_000;
		this.rpcSizeLimit = 50_000;
		this.cfx = cfx;
		this.range = range;
		let curJob = new LogsJob({fromEpoch: from, range, toEpoch: from + range});
		curJob.start(cfx)

		this.head = this.runningJob = this.buildingJob = curJob;

		for (let i = 1; i < jobCount; i++) {
			from = curJob.toEpoch + 1;

			const tmpJob = new LogsJob({fromEpoch: from, range, toEpoch: from + range});
			tmpJob.start(cfx)

			curJob.next = tmpJob;
			tmpJob.pre = curJob;
			curJob = tmpJob;
		}
		this.tail = curJob;
		this.checkRPC().then()
	}

	async checkRPC() {
		const {cfx, runningJob: {fromEpoch, toEpoch, range: rangeC, logs}, range, tail} = this
		let startNewJob = true
		if (fromEpoch - this.head.fromEpoch > this.rpcSizeLimit) {
			console.log(`wait for consumer.`)
			await sleep(2_000)
			startNewJob = false
		}
		try {
			await logs
		} catch (e) {
			startNewJob = false;
			console.log(`${__filename} failed to get logs [${fromEpoch}, ${toEpoch}]:`, e.message);
			//fork two jobs
			if (rangeC == 1) {
				// try again
				await sleep(1_000);
				this.runningJob.start(cfx)
			} else {
				console.log(`fork ...`)
				let newRange = Math.round(rangeC / 2)
				this.runningJob.range = newRange
				this.runningJob.toEpoch = fromEpoch + newRange
				this.runningJob.forked = true;
				this.runningJob.start(cfx);

				const newFe = this.runningJob.toEpoch + 1
				const tmpJob = new LogsJob({fromEpoch: newFe, range: toEpoch - newFe, toEpoch: toEpoch});
				tmpJob.waitPre = true;
				// right link
				if (this.runningJob === this.tail) {
					this.tail = tmpJob;
				} else {
					tmpJob.next = this.runningJob.next;
					this.runningJob.next.pre = tmpJob;
				}
				// left link
				this.runningJob.next = tmpJob;
				tmpJob.pre = this.runningJob;
				// tmpJob.start(cfx) // do not start
			}
		}
		if (startNewJob) {
			if (this.runningJob.next?.waitPre) {
				this.runningJob.next.start(cfx); //
			} else {
				const newFe = tail.toEpoch + 1
				const tmpJob = new LogsJob({fromEpoch: newFe, range, toEpoch: newFe + range});
				tail.next = tmpJob;
				tmpJob.pre = tail;
				this.tail = tmpJob;
				tmpJob.start(cfx)
			}

			this.runningJob = this.runningJob.next
		}
		setTimeout(() => this.checkRPC(), 0);
	}
}

export class LogFetcher {
	cfx: Conflux
	tokenTool: TokenTool
	logJobStream: LogsJobStream
	extBuilder: Function
	private maxBlockEpoch: number;

	// The gap between from_epoch and to_epoch is larger than max_gap (from: ..., to: ..., max_gap: 1000)
	constructor(cfx: Conflux, fromEpoch: number, range: number, jobCount: number) {
		patchCfxGetLogs(cfx);
		if (range >= 1000) {
			throw new Error(`logs range exceeds , should < 1000`)
		}
		this.tokenTool = new TokenTool(cfx);
		this.cfx = cfx;
		this.logJobStream = new LogsJobStream();
		this.logJobStream.start(fromEpoch, range, jobCount, cfx);
	}

	async next(epoch: number) {
		let {head, buildingJob} = this.logJobStream;
		if (epoch !== head.fromEpoch) {
			return Promise.reject(`want epoch ${epoch} != head epoch ${head.fromEpoch}`)
		}
		while (head === buildingJob) {
			console.log(`final data not ready, want ${epoch}`)
			await sleep(1_000);
			({head, buildingJob} = this.logJobStream);
		}
		this.logJobStream.head = head.next;
		head.next.pre = undefined;
		head.next = undefined;
		return head.result;
	}

	async building() {
		let delay = 0;
		const {logJobStream: {buildingJob, head, runningJob, dataSizeLimit}} = this;
		if (runningJob === buildingJob) {
			// RPC data is not ready yet.
			console.log(`RPC data is not ready yet. [${runningJob.fromEpoch} , ${runningJob.toEpoch}] elapsed ${Date.now() - runningJob.beginMs}ms`)
			delay = 1_000
		} else if (buildingJob.fromEpoch - head.fromEpoch > dataSizeLimit) {
			// The data queue is waiting for persistence
			console.log(`The data queue is waiting for persistence. built from epoch ${buildingJob.fromEpoch
			} head from epoch ${head.fromEpoch}`)
			delay = 1_000
		} else {
			let logsReady = true;
			const logs = await buildingJob.logs.catch(e=>{
				logsReady = false;
				console.log(`logs are not ready when building them. `, e.message)
				delay = 10_000;
				return []
			});
			try {
				buildingJob.result = !logsReady ? null : await this.assemble(buildingJob, logs).then(info => {
					// token transfer sync -> buildTransferInfo
					return this.extBuilder(undefined, info, '', '')
				}).then(res => {
					res.nextEpoch = buildingJob.toEpoch + 1;
					res.toEpoch = buildingJob.toEpoch;
					return res;
				});
				logsReady && (this.logJobStream.buildingJob = this.logJobStream.buildingJob.next);
			} catch (e) {
				console.log(`${__filename} assemble failure`, e)
				delay = 10_000;
			}
		}
		setTimeout(() => this.building(), delay);
	}

	async assemble(job: LogsJob, logs: Log[]) {
		// console.log(`assemble [${job.fromEpoch},${job.toEpoch}](${job.range}) logs ${logs.length}`)
		const receipts = this.buildAsReceipts(logs);
		if (logs.length) {
			const lastEp = logs[logs.length - 1].epochNumber;
			let times = 0;
			do {
				if (lastEp <= this.maxBlockEpoch) {
					break;
				}
				if (times > 0) {
					console.log(`${__filename} block/tx not ready, want ${lastEp} , got ${this.maxBlockEpoch}`)
					await sleep(5_000)
				}
				this.maxBlockEpoch = await loadMaxBlockEpoch();
				times ++
			} while (true)
		}
		const transferInfo = decodeTransferFromReceipts(receipts, this.tokenTool, null);
		const {t20, t721, t1155, approvals} = transferInfo;
		const fillTxInfoTaskArr = [];
		const txCache = new Map<string, Promise<FullTransaction>>();
		[t20, t721, t1155, approvals].forEach(arr => {
			arr.forEach(transfer => {
				fillTxInfoTaskArr.push(limit(async () => {
					let p = txCache.get(transfer.transactionHash);
					if (!p) {
						p = FullTransaction.findOne({where: {hash: transfer.transactionHash, epoch: transfer.epochNumber}});
						txCache.set(transfer.transactionHash, p);
					}
					const tx = await p;
					if (!tx) {
						return Promise.reject(`tx not found for ${JSON.stringify(transfer)}`);
					} else {
						transfer['transactionIndex'] = tx.txPosition; //tx.index;
						transfer['blockIndex'] = tx.blockPosition;
						transfer['createdAt'] = tx.createdAt;
					}
				}))
			})
		})
		txCache.clear();
		await Promise.all(fillTxInfoTaskArr)
		return transferInfo;
	}

	buildAsReceipts(logs: Log[]) {
		const ret = [] as TransactionReceipt[][];
		let lastBlock = '';
		let blockReceipts = undefined as TransactionReceipt[]
		let lastTx = undefined as TransactionReceipt;
		for (const log of logs) {
			if (log.blockHash != lastBlock) {
				lastBlock = log.blockHash
				blockReceipts = []
				ret.push(blockReceipts);
			}
			if (lastTx?.transactionHash != log.transactionHash) {
				lastTx = {
					logs: [], outcomeStatus: 0, transactionHash: log.transactionHash,
					epochNumber: log.epochNumber,
				} as TransactionReceipt;
				blockReceipts.push(lastTx)
			}
			lastTx.logs.push(log);
		}
		return ret;
	}
}
