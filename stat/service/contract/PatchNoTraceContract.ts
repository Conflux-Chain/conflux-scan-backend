

// functions for chains without `trace` rpc
// migrate tx.contractCreated to trace_create_contract table

import {ITraceCreateContract, TraceCreateContract} from "../../model/TraceCreateContract";
import {Contract} from "../../model/Contract";
import {Op, QueryTypes} from "sequelize";
import {FullBlock, FullTransaction} from "../../model/FullBlock";
import {init} from "../tool/FixDailyTokenStat";
import {format} from "js-conflux-sdk";
import {Token} from "../../model/Token";
import {KV, TRACE_CONTRACT_TOKEN_ID} from "../../model/KV";
import {MINUTE} from "../common/utils";

let tokenContracts = {

} as {[key:number]: boolean}

export async function startMonitorContractCreated() {
	try {
		await checkToken();
		await check();
	} catch (e) {
		console.log(`Failed to run MonitorContractCreated: `, e);
	}
	setTimeout(startMonitorContractCreated, MINUTE);
}
/*
select token.hex40id, token.base32, token.createdAt from token left join contract on token.hex40id=contract.hex40id
where contract.id is null
 */
async function checkToken() {
	let goon = false;
	do {
		goon = await checkTokenRound();
	} while (goon);
}
async function checkTokenRound() {
	const maxTokenTableId = await Token.max('id').then(res=> res as number);
	if (!maxTokenTableId) {
		return false;
	}
	const preTokenId = await KV.getNumber(TRACE_CONTRACT_TOKEN_ID, 0);
	if (maxTokenTableId <= preTokenId) {
		return false;
	}
	const size = 10000;
	const boundTo = Math.min(preTokenId + size, maxTokenTableId);
	// token contract created by in-direct tx.
	// fix them.
	const sql = `
	select token.id, token.name, token.hex40id, token.base32, token.createdAt from token left join contract on token.hex40id=contract.hex40id
 where token.id > ${preTokenId} and token.id <= ${boundTo} and contract.id is null
	`
	const list:Token[] = await Token.sequelize.query(sql, {
		type: QueryTypes.SELECT, raw: true
	})
	console.log(`token contract count ${list.length} , with token id > ${preTokenId} , <= ${boundTo}`);
	const maxBlock = await FullBlock.findOne({order:[['epoch', 'desc']]});
	if (maxBlock == null) {
		console.log(`no block`)
		return false;
	}
	let maxTokenId = list.length ? 0 : boundTo;
	for (let i = 0; i < list.length; i++){
		const token = list[i];
		maxTokenId = Math.max(maxTokenId, token.id);
		if (maxBlock.createdAt.getTime() < token["createdAt"].getTime()) {
			console.log(` token is too fresh. ${token.name} ${format.hexAddress(token.base32)}`)
			continue
		}
		await Contract.create(
			{base32: token.base32, hex40id: token.hex40id, epoch: 0}
		).catch(e=>{
			console.log(`error creating mock contract record: `, e);
		})
		tokenContracts[token.hex40id] = true
		console.log(`${i} create mock contract for token ${token.name} ${format.hexAddress(token.base32)}`)
	}
	await KV.saveNumber(TRACE_CONTRACT_TOKEN_ID, maxTokenId.toString(), null);

	return true;
}
async function check() {
	let maxTrace = await TraceCreateContract.findOne({
		order: [['to', 'desc']],
	})
	let maxTraceId = maxTrace?.to ?? 0;
	let round = 0
	do {
		const c = await Contract.findOne({
			where: {hex40id: {[Op.gt]: maxTraceId}}, order: [['hex40id', 'asc']], raw: true
		})
		if (c == null) {
			console.log(`no contract with hex40id > ${maxTraceId}`)
			break
		}
		maxTraceId = c.hex40id;
		if (c.epoch == null) {
			// nameSymbolFailed records
			continue;
		}
		const dbTx = await FullTransaction.findOne({where: {epoch: c.epoch, contractCreatedId: c.hex40id}});

		if (!dbTx && !tokenContracts[c.hex40id]) {
			if (c.epoch == 0) {
				console.log(`skip contract with epoch 0, ${c.base32}`);
				continue;
			}
			if (ignoreNotFound) {
				continue
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
			blockTime: dbTx ? dbTx.createdAt.getTime() / 1000 : 0,
			from: dbTx?.fromId || 0,
			to: c.hex40id,
			traceIndex: 0,
			value: 0,
			outcome: "",
		} as ITraceCreateContract;
		if (!dryRun) {
			await TraceCreateContract.bulkCreate([mockTrace], {ignoreDuplicates: true}).catch(e=>{
				console.log(`${__filename} failed to create mock trace create contract`, e);
			})
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
