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
	patchFn: Function;
}

class LogsJob {
	fromEpoch: number
	toEpoch: number
	range: number
	forked: boolean
	waitPre?: boolean

	rpcBeginMs: number;
	buildBeginMs: number;
	buildEndMs: number
	logs?: Promise<Log[]>
	patchFn: Function;
	result?: Promise<any>;
	resultResolver: Function;
	resultRejecter: Function;

	pre?: LogsJob
	next?: LogsJob

	constructor({fromEpoch, toEpoch, range, patchFn}: IJob) {
		if (isNaN(toEpoch) || isNaN(range) || isNaN(fromEpoch)) {
			throw new Error(`bad params ${fromEpoch} , ${toEpoch} , ${range}`)
		}
		// console.log(`new job [${fromEpoch} , ${toEpoch}], ${range}`)
		this.fromEpoch = fromEpoch;
		this.toEpoch = toEpoch;
		this.range = range;
		this.patchFn = patchFn;
		this.result = new Promise((ok, fail)=>{
			this.resultResolver = ok;
			this.resultRejecter = fail;
		})
	}

	start(cfx: Conflux) {
		this.rpcBeginMs = Date.now();
		this.logs = cfx.getLogs({fromEpoch: this.fromEpoch, toEpoch: this.toEpoch});
		this.logs.then(logs=>{
			return this.patchFn(this, logs)
		}).then(res=>{
			res.nextEpoch = this.toEpoch + 1;
			res.toEpoch = this.toEpoch;
			return res;
		}).then(v=>this.resultResolver(v));
	}
}

class LogsJobStream {
	head: LogsJob
	tail: LogsJob
	range: number
	dataSizeLimit: number
	rpcSizeLimit: number
	cfx: Conflux
	private maxBlockEpoch: number;

	runningJob: LogsJob
	patchFn: Function;

	constructor(patchFn: Function) {
		this.patchFn = patchFn;
	}

	async start(from: number, range: number, jobCount: number, cfx: Conflux) {
		this.dataSizeLimit = 20_000;
		this.rpcSizeLimit = 50_000;
		this.cfx = cfx;
		this.range = range;
		let curJob = new LogsJob({fromEpoch: from, range, toEpoch: from + range, patchFn: this.patchFn});
		await this.safeStartJob(curJob, cfx);

		this.head = this.runningJob = curJob;

		for (let i = 1; i < jobCount; i++) {
			from = curJob.toEpoch + 1;

			const tmpJob = new LogsJob({fromEpoch: from, range, toEpoch: from + range, patchFn: this.patchFn});
			await this.safeStartJob(tmpJob, cfx);

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
				const tmpJob = new LogsJob({fromEpoch: newFe, range: toEpoch - newFe, toEpoch: toEpoch, patchFn: this.patchFn});
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
				await this.safeStartJob(this.runningJob.next, cfx);
			} else {
				const newFe = tail.toEpoch + 1
				const tmpJob = new LogsJob({fromEpoch: newFe, range, toEpoch: newFe + range, patchFn: this.patchFn});
				tail.next = tmpJob;
				tmpJob.pre = tail;
				this.tail = tmpJob;
				await this.safeStartJob(tmpJob, cfx);
			}

			this.runningJob = this.runningJob.next
		}
		setTimeout(() => this.checkRPC(), 0);
	}

	private async safeStartJob(tmpJob: LogsJob, cfx: Conflux) {
		await this.waitDbBlock(tmpJob.toEpoch);
		tmpJob.start(cfx)
	}

	private async waitDbBlock(lastEp: number) {
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
			times++
		} while (true)
	}
}

export class LogFetcher {
	cfx: Conflux
	tokenTool: TokenTool
	logJobStream: LogsJobStream
	extBuilder: Function

	// The gap between from_epoch and to_epoch is larger than max_gap (from: ..., to: ..., max_gap: 1000)
	constructor(cfx: Conflux, fromEpoch: number, range: number, jobCount: number) {
		patchCfxGetLogs(cfx);
		if (range >= 1000) {
			throw new Error(`logs range exceeds , should < 1000`)
		}
		this.tokenTool = new TokenTool(cfx);
		this.cfx = cfx;
		this.logJobStream = new LogsJobStream((job: LogsJob, logs: Log[])=>this.assemble(job, logs).then(info=>{
			return this.extBuilder(undefined, info, '', '');
		}));
		this.logJobStream.start(fromEpoch, range, jobCount, cfx).then();
	}

	async next(epoch: number) {
		let {head, runningJob} = this.logJobStream;
		if (epoch !== head.fromEpoch) {
			return Promise.reject(`want epoch ${epoch} != head epoch ${head.fromEpoch}`)
		}
		while (head === runningJob) {
			// console.log(`final data not ready, want ${epoch}`)
			await head.logs.catch(()=>{
				return sleep(1_000)
			});
			({head, runningJob} = this.logJobStream);
		}
		await head.result;
		this.logJobStream.head = head.next;
		head.next.pre = undefined;
		head.next = undefined;
		return head.result;
	}

	async assemble(job: LogsJob, logs: Log[]) {
		job.buildBeginMs = Date.now();
		// console.log(`assemble [${job.fromEpoch},${job.toEpoch}](${job.range}) logs ${logs.length}`)
		const receipts = buildAsReceipts(logs);
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
		job.buildEndMs = Date.now();
		return transferInfo;
	}
}

function buildAsReceipts(logs: Log[]) {
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
