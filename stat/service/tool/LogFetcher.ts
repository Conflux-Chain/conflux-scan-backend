import {Conflux} from "js-conflux-sdk";
import {Log, TransactionReceipt} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {decodeTransferFromReceipts} from "../../TokenTransferSync";
import {TokenTool} from "./TokenTool";

import pLimit from "p-limit";
import {FullTransaction, loadMaxBlockEpoch} from "../../model/FullBlock";
import {sleep} from "./ProcessTool";

const limit = pLimit(100);

class LogsJob {
	fromEpoch: number
	toEpoch?: number
	range: number
	forked: boolean

	logs?: Promise<Log[]>
	result?: any;

	pre?: LogsJob
	next?: LogsJob

	start(cfx: Conflux) {
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
		let curJob = {fromEpoch: from, range, toEpoch: from + range} as LogsJob;
		curJob.start(cfx)

		this.head = this.runningJob = this.buildingJob = curJob;

		for (let i = 1; i < jobCount; i++) {
			from = curJob.toEpoch + 1;

			const tmpJob = {fromEpoch: from, range, toEpoch: from + range} as LogsJob;
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
			await sleep(2_000)
			startNewJob = false
		}
		let logsCount = 0
		try {
			const logsV = await logs
			logsCount = logsV.length;
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
				const tmpJob = {fromEpoch: newFe, range: toEpoch - newFe, toEpoch: toEpoch} as LogsJob;
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
			if (this.runningJob.forked) {
				if (logsCount > 500) {
					// indicate that the next job should fork
					this.runningJob.next.logs = Promise.reject("previous forked job has too many logs")
				} else {
					this.runningJob.next.start(cfx); //
				}
			} else {
				const newFe = tail.toEpoch + 1
				const tmpJob = {fromEpoch: newFe, range, toEpoch: newFe + range} as LogsJob;
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

	constructor(cfx: Conflux, fromEpoch: number, range: number) {
		this.cfx = cfx;
		this.logJobStream = new LogsJobStream();
		this.logJobStream.start(fromEpoch, range, 10, cfx);

		this.building().then()
	}

	async next(epoch: number) {
		const {head, buildingJob} = this.logJobStream;
		if (epoch !== head.fromEpoch) {
			return Promise.reject(`want epoch ${epoch} != head epoch ${head.fromEpoch}`)
		}
		while (head === buildingJob) {
			if (Date.now() % 60_000 === 0) {
				console.log(`final data not ready, want ${epoch}`)
			}
			await sleep(1_000);
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
			console.log(`RPC data is not ready yet. rpc from epoch ${runningJob.fromEpoch}`)
			delay = 1_000
		} else if (buildingJob.fromEpoch - head.fromEpoch > dataSizeLimit) {
			// The data queue is waiting for persistence
			console.log(`The data queue is waiting for persistence. built from epoch ${buildingJob.fromEpoch
			} head from epoch ${head.fromEpoch}`)
			delay = 1_000
		} else {
			const logs = await this.logJobStream.head.logs;
			try {
				this.logJobStream.head.result = await this.assemble(logs).then(info => {
					// token transfer sync -> buildTransferInfo
					return this.extBuilder(undefined, info, '', '')
				}).then(res => {
					res.nextEpoch = head.toEpoch + 1;
					return res;
				});
				this.logJobStream.buildingJob = this.logJobStream.buildingJob.next;
			} catch (e) {
				console.log(`${__filename} assemble failure`, e)
				delay = 10_000;
			}
		}
		setTimeout(() => this.building(), delay);
	}

	async assemble(logs: Log[]) {
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
		[t20, t721, t1155, approvals].forEach(arr => {
			arr.forEach(transfer => {
				fillTxInfoTaskArr.push(limit(async () => {
					const tx = await FullTransaction.findOne({where: {hash: transfer.transactionHash}});
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
