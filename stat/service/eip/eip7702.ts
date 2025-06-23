import {JsonRpcProvider} from "@ethersproject/providers/src.ts/json-rpc-provider";
import {AuthAction, AuthBlockStub, listAuthAction} from "../../model/EIP7702model";
import {safeAddErrorLog} from "../../monitor/ErrorMonitor";
import {initEthSdk, MINUTE, SECOND} from "../common/utils";
import {ConfigInstance, NoCoreSpace} from "../../config/StatConfig";
import {Op} from "sequelize";
import {sleep} from "../tool/ProcessTool";
import {init} from "../tool/FixDailyTokenStat";

export async function loadSetAuth(netProvider: JsonRpcProvider, blockNumber: number) {
	const method = 'trace_blockSetAuth'
	const result = await netProvider.send(method, ['0x'+blockNumber.toString(16)]).catch(e=>{
		if (e.code === 'SERVER_ERROR') {
			console.log(`${__filename} , ${method} , ${e.body || e.message} ${e.url}`);
			return {}
		}
		throw e;
	});
	for (const entry of result) {
		entry.action.chainId = parseInt(entry.action.chainId.substr(2), 16);
		entry.action.nonce = parseInt(entry.action.nonce.substr(2), 16);
		if (entry.result.length > 32) {
			entry.result = entry.result.substr(0, 32);
		}
	}
	// console.log(`result of set auth is `, result);
	return result;
}

const ctx = {
	netProvider: null as JsonRpcProvider,
}
const NOT_FOUND = 404;

export function initAuthRpc() {
	if (ctx.netProvider == null) {
		ctx.netProvider = initEthSdk(ConfigInstance.ether?.url);
		if (!ctx.netProvider) {
			console.log(`${__filename} : You must set ether RPC!`)
		}
	}
}

export function saveAuthBlockStub(blockNumber: number, blockHash: string) {
	function failed(e) {
		safeAddErrorLog(`eip7702`, `saveStub`, e);
	}
	try {
		AuthBlockStub.create({
			blockNumber: blockNumber, blockHash: blockHash
		}).catch(e=>{
			failed(e);
		});
	} catch (e) {
		failed(e);
	}
}

export async function do7702AuthTask() {
	let delay = 0;
	try {
		const {code, message} = await process7702AuthStub();
		if (code === NOT_FOUND) {
			delay = MINUTE;
		} else if (code != 0) {
			delay = SECOND * 10;
			console.log(`failed to process auth tx stub,`, message);
		}
	} catch (error) {
		safeAddErrorLog('eip7702', 'auth-task', error);
		console.log(`failed to process auth tx stub: `, error);
		delay = SECOND * 30;
	}
	setTimeout(do7702AuthTask, delay);
}

export async function process7702AuthStub() {
	const actionWithMaxRefId = await AuthAction.findOne({
		order: [['refBlockStubId', 'desc']], raw: true,
	});
	const stub = await AuthBlockStub.findOne({
		order: [['id', 'DESC']], raw: true,
		where: {id: {[Op.gt]: actionWithMaxRefId?.refBlockStubId || 0}}
	})
	if (!stub) {
		return {code: NOT_FOUND};
	}
	const rpcResult = await loadSetAuth(ctx.netProvider, stub.blockNumber) as any[];
	const dbBeanArr = [];
	let authIndex = -1;
	for (const entry of rpcResult) {
		authIndex ++;
		const {action, blockHash, blockNumber, transactionPosition, result} = entry;
		if (blockNumber != stub.blockNumber) {
			safeAddErrorLog('eip7702', 'auth-action', new Error(`block number mismatch`))
			return {code: 500, message: `block number mismatch at ${stub.blockNumber}`};
		} else if (blockHash != stub.blockHash) {
			// pivot changed? find stub with the same block number, but large DB id.
			const hasNext = await checkLaterStub(blockNumber, stub.id);
			if (hasNext) {
				await AuthBlockStub.sequelize.transaction(dbTx=>{
					return Promise.all([
						AuthBlockStub.destroy({where: {id: stub.id}, transaction: dbTx}),
						AuthAction.destroy({where: {blockNumber: blockNumber}, transaction: dbTx}),
					])
				})
				console.log(`there is another stub, destroy this one`, stub);
				return {code: 0};
			}
			safeAddErrorLog('eip7702', 'auth-action', new Error(`block hash mismatch`))
			return {code: 500, message: `block hash mismatch at ${stub.blockHash}`};
		}
		action['refBlockStubId'] = stub.id;
		action['blockNumber'] = stub.blockNumber;
		action['transactionPosition'] = transactionPosition;
		action['authIndex'] = authIndex;
		action['result'] = result;
		dbBeanArr.push(action);
	}
	await AuthAction.bulkCreate(dbBeanArr, {
		updateOnDuplicate: ['refBlockStubId', 'result', 'updatedAt'] as any,
	});

	return {code: 0};
}

async function checkLaterStub(blockNumber: number, dbId: number) {
	let tryTimes = 1;
	while (tryTimes <= 5) {
		const next = await AuthBlockStub.findOne({
			where: {blockNumber, id: {[Op.gt]: dbId}}
		})
		if (next) {
			return true;
		}
		console.log(`block stub not found, block `, blockNumber, ' base id', dbId, 'tryTimes', tryTimes);
		await sleep(SECOND * 5);
	}
	console.log(`block stub not found, block `, blockNumber, ' base id', dbId);
	return false;
}

async function main() {
	const [, , cmd, arg1] = process.argv;
	if (cmd === 'tx') {
		await init();
		const arr = await listAuthAction({author: arg1, skip: 0, limit: 10});
		console.log(JSON.stringify(arr, null, 4));
		await AuthAction.sequelize.close();
	}
}
async function testLoadAuth() {
	let url = '';
	url = 'http://194.233.87.244/8889cfx'
	url = 'http://194.233.94.75:8545'
	const { ethers } = require("ethers");

// 替换为你的 JSON-RPC 节点 URL
	const provider = new ethers.providers.JsonRpcProvider(url);
	// '0xa37384c0646a682bd0e206232572af91b75e6735ab30b658854222546f76ffbc'
	await loadSetAuth(provider, 53098075);
}

if(module == require.main) {
	main().then();
}
