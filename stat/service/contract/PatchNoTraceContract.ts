

// functions for chains without `trace` rpc
// migrate tx.contractCreated to trace_create_contract table

import {ITraceCreateContract, TraceCreateContract} from "../../model/TraceCreateContract";
import {Contract} from "../../model/Contract";
import {Op} from "sequelize";
import {FullTransaction} from "../../model/FullBlock";
import {init} from "../tool/FixDailyTokenStat";
import {format} from "js-conflux-sdk";

export async function startMonitorContractCreated() {
	await check();
	setInterval(check, 10_000);
}

async function check() {
	let maxTrace = await TraceCreateContract.findOne({
		order: [['id', 'desc']],
	})
	let maxTraceId = maxTrace?.id ?? 263796;
	let round = 0
	do {
		const c = await Contract.findOne({
			where: {id: {[Op.gt]: maxTraceId}}, order: [['id', 'asc']], raw: true
		})
		if (c == null) {
			console.log(`no contract with id > ${maxTraceId}`)
			break
		}
		maxTraceId = c.id;
		const dbTx = await FullTransaction.findOne({where: {epoch: c.epoch, contractCreatedId: c.hex40id}});

		if (!dbTx) {
			if (ignoreNotFound) {
				continue
			}
			if (c.epoch == 0) {
				console.log(`skip contract with epoch 0, ${c.base32}`);
				continue;
			}
			console.log(`db tx not found, epoch ${c.epoch} , hex40id ${c.hex40id} hex ${format.hexAddress(c.base32)}`)
			if (!dryRun) {
				break
			}
		}
		const mockTrace = {
			id: c.id,
			epochNumber: c.epoch,
			txHashId: 0,
			txHash: dbTx?.hash.slice(2) || "",
			blockTime: dbTx?.createdAt.getTime(),
			from: dbTx?.fromId,
			to: c.hex40id,
			traceIndex: 0,
			value: 0,
			outcome: "",
		} as ITraceCreateContract;
		if (!dryRun) {
			await TraceCreateContract.create(mockTrace)
		}
		if (round % 100 == 0) {
			console.log(`create mock trace contract creation, id ${c.id} round ${round}`)
		}
		round ++;
	} while (true)
}
let dryRun = false
let ignoreNotFound = false
async function main() {
	const [,,cmd] = process.argv
	dryRun = cmd == 'dry'
	ignoreNotFound = process.argv.includes("ignore")
	const cfg = await init()
	startMonitorContractCreated().then()
}

// node stat/service/contract/PatchNoTraceContract.js
if (module == require.main) {
	main().then()
}
