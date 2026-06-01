import {AuthAction, AuthBlockStub, listAuthAction} from "../../model/EIP7702model";
import {safeAddErrorLog} from "../../monitor/ErrorMonitor";
import {getCfxSdk, initEthSdk, mustBeAddressParamIfPresent, SECOND} from "../common/utils";
import {ConfigInstance} from "../../config/StatConfig";
import {Op} from "sequelize";
import {sleep} from "../tool/ProcessTool";
import {init} from "../tool/FixDailyTokenStat";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {getAddrId, Hex40Map, makeId, makeIdV} from "../../model/HexMap";
import {Errors} from "../common/LogicError";
import {ethers, JsonRpcProvider} from "ethers";

type AccountType = {
	isContract: boolean,
	delegatedTo: string,
	extraMessage: string,
}

export async function detectAccountType(hex: string) : Promise<AccountType> {
	if (!hex) {
		throw new Errors.ParameterError(`parameter <hex> is required`)
	}
	const result: AccountType = {
		isContract: false,
		delegatedTo: '',
		extraMessage: '',
	};
	const sdk = getCfxSdk();
	if (!sdk) {
		throw new Error(`SDK not initialized`);
	}
	const addrId = await getAddrId(hex);
	if (addrId) {
		const creation = await TraceCreateContract.findOne({
			where: {to: addrId},
		});
		if (creation) {
			result.isContract = true;
			result.extraMessage = `creation exists`;
			return result;
		}
	} else {
		result.extraMessage = "No such address";
	}
	// check code
	let rpcError = false;
	const codeOnChain = await sdk.getCode(hex).catch(e=>{
		result.extraMessage = `failed to get code: ${e}`;
		rpcError = true;
	});
	if (rpcError) {
		return result;
	}
	if (!codeOnChain || codeOnChain === '0x') {
		result.extraMessage = `code is empty`;
		return result;
	}

	if (!addrId) {
		await makeId(hex, null, {dt: new Date()});
	}

	const prefix = "0xef0100";
	if (codeOnChain.length === 48 && codeOnChain.startsWith(prefix)) {
		result.delegatedTo = '0x' + codeOnChain.substr(prefix.length);
		result.extraMessage = `EOA with delegated code`;
		return result;
	}
	result.isContract = true;
	result.extraMessage = `code length: ${codeOnChain.length}`;
	return result;
}

export async function loadSetAuth(netProvider: JsonRpcProvider, blockNumber: number) {
	const method = 'trace_blockSetAuth'
	const blockHex = '0x'+blockNumber.toString(16);
	const result = await netProvider.send(method, [blockHex]).catch(e=>{
		if (e.code === 'SERVER_ERROR') {
			console.log(`${__filename} , ${method} , ${e.body || e.message} ${e.url}`);
			return {}
		}
		throw e;
	});
	const txMap = new Map<string, any>();
	const blockDetail = await netProvider.send('eth_getBlockByNumber', [blockHex, true]);
	blockDetail.transactions.forEach(transaction => {
		txMap.set(transaction.hash, transaction);
	})
	let idx = -1;
	for (const entry of result) {
		idx ++;
		entry.action.chainId = parseInt(entry.action.chainId.substr(2), 16);
		entry.action.nonce = parseInt(entry.action.nonce.substr(2), 16);
		if (entry.result.length > 32) {
			entry.result = entry.result.substr(0, 32);
		}
		const tx = txMap.get(entry.transactionHash);
		if (!tx) {
			console.log(`tx not found`, entry.transactionHash, ' block ', blockNumber, ' ', blockHex);
			continue;
		}
		const reqAuth = tx.authorizationList[idx];
		if (!reqAuth) {
			console.log(`req auth entry not found`, entry);
			continue;
		}
		entry.action.yParity = reqAuth.yParity;
		entry.action.r = reqAuth.r;
		entry.action.s = reqAuth.s;
		// invalid_chain_id case, the RPC returns null author.
		if (!entry.action.author) {
			try {
				entry.action.author = recoverEIP7702Author({
					...entry.action, signature: buildSignature(entry.action)
				});
			} catch (e) {
				entry.action.author = '';
				safeAddErrorLog(`eip7702`, `recover-author`, e);
			}
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

/**
 * Save the block hash here and let another thread process these blocks one by one.
 * In case of a chain reorg, it will track all blocks that appear.
 */
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
			delay = SECOND * 5;
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
		order: [['id', 'asc']], raw: true,
		where: {id: {[Op.gt]: actionWithMaxRefId?.refBlockStubId || 0}}
	})
	if (!stub) {
		return {code: NOT_FOUND};
	}
	// console.log(`process block `, stub.blockNumber, ' stub id ', stub.id);
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
		await makeIdV(action['author'], null, {dt: stub['createdAt']})
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

const authExample =     {
	chainId: '0x0',
	address: '0x2753725095eee1d5d0bcbf7e6acc94b47e2249a8',
	nonce: '0xc',
	yParity: '0x0',
	r: '0x6a3d86169c82dc44b6e5422eabeff2bc9d9435aeee0781110413187865beb08b',
	s: '0x1fd9873e5d115b1c2e642594548ea9df83405285134b908d0d90571135e2045b'
}

// {chainId, address, nonce, yParity, r, s}
function buildSignature(data = authExample) {
	// 1. 构造签名 (65 字节: r + s + v)
	const v = ethers.toBeHex(data.yParity); // "0x0" → 需要转成 "0x00"
	const signature = ethers.concat([
		data.r,
		data.s,
		ethers.zeroPadValue(v, 1) // 确保 v 是 1 字节 (0x00 或 0x01)
	]);
	console.log("Signature:", ethers.hexlify(signature));
	return signature;
}

// 2. 恢复 EIP-7702 的 author
function recoverEIP7702Author({ chainId, address, nonce, signature }) {
	// RLP 编码 [chainId, address, nonce]
	const rlpEncoded = ethers.encodeRlp([
		ethers.hexlify(ethers.toBeHex(chainId)),
		address,
		ethers.hexlify(ethers.toBeHex(nonce)),
	]);

	// 添加前缀 0x05
	const prefixedData = ethers.concat(["0x05", rlpEncoded]);

	// 计算 Keccak-256 哈希
	const hash = ethers.keccak256(prefixedData);

	// 恢复地址
	return ethers.recoverAddress(hash, signature);
}

// node stat/service/eip/eip7702.js tx
async function main() {
	const [, , cmd, arg1] = process.argv;
	if (cmd === 'tx') {
		await init();
		const arr = await listAuthAction({author: arg1, skip: 0, limit: 10});
		console.log(JSON.stringify(arr, null, 4));
		await AuthAction.sequelize.close();
	} else if (cmd === 'recover-auth') {
		const sig = buildSignature(authExample);
		const author = recoverEIP7702Author({...authExample, signature: sig});
		console.log(`author: ${author}`);
	}
}
async function testLoadAuth() {
	let url = '';
	url = ''
	const { ethers } = require("ethers");

// 替换为你的 JSON-RPC 节点 URL
	const provider = new JsonRpcProvider(url);
	// '0xa37384c0646a682bd0e206232572af91b75e6735ab30b658854222546f76ffbc'
	await loadSetAuth(provider, 53098075);
}

if(module == require.main) {
	main().then();
}
// node stat/service/eip/eip7702.js recover-auth
