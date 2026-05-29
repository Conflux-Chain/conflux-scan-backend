import {
	IAccountDeployedEvent,
	IUserOperationEvent,
	parseAccountDeployed,
	parseUserOperationEvent,
	parseUserOperationRevertReason
} from "./eip4337abi";
import {
	AATx, AccountDeployed,
	BundleTx, entrypointAddrIdSet, entrypointAddrSet,
	IAATx,
	IAccountDeployed,
	IBundleTx,
	IUserOperationRevertReason,
	UserOperationRevertReason
} from "../../model/eip4337model";
import {formatEther} from "ethers";
import {makeIdV} from "../../model/HexMap";
import {Op, Transaction} from "sequelize";
import {Conflux, format} from "js-conflux-sdk";
import {init} from "../tool/FixDailyTokenStat";
import {getCfxSdk, initCfxSdk} from "../common/utils";
import {ContractQuery} from "../ContractQuery";
import {queryAATx, queryBundleTx, fillAATxMethodInfo, getAATxDetail} from "./eip4337query";
import {Block, TransactionReceipt, Transaction as SdkTx} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {IDBAction} from "../BatchDBTx";
import {
	build7702methodIds,
	getPaymasterAddress,
	I4337call,
	parseAATxMethods,
	readOpHash,
	testParse4337Func
} from "./eip4337decoder";
import {loadConfig} from "../../config/StatConfig";
import {parseBundleTxByHash} from "./eip4337bundleParser";
import {IS_EVM2, KV} from "../../model/KV";
import {AddressTransactionIndex} from "../../model/FullBlock";

export interface IBundleData {
	parsed4337call: I4337call,
	bundlerTx: IBundleTx;
	bundlerTxId: bigint;
	aaTxArr: IAATx[];
	accountDeployedArr: IAccountDeployed[];
	revertReasonArr: IUserOperationRevertReason[];
	hasData: boolean;
}

export async function buildAATxDBModel(op: IUserOperationEvent, blockTime: Date) : Promise<IAATx> {
	return {
		actualGasCost: formatEther(op.actualGasCost),
		actualGasUsed: op.actualGasUsed.toString(),
		bundleTxId: 0n,
		eventContractId: await makeIdV(op.address, null, {dt: blockTime}),
		createdAt: blockTime,
		epoch: 0n,
		id: 0n,
		nonce: op.nonce.toString(),
		paymasterId: await makeIdV(op.paymaster, null, {dt: blockTime}),
		senderId: await makeIdV(op.sender, null, {dt: blockTime}),
		bundlerId: 0,
		entryPointId: 0,
		success: op.success,
		userOpHash: op.userOpHash,
		methods: '',
		method7702: '',
	};
}

export async function pop4337data(epoch: number|any, dbTx: Transaction) {
	const options = {where: {epoch} , transaction: dbTx};

	await AATx.destroy(options);
	await UserOperationRevertReason.destroy(options);
	await AccountDeployed.destroy(options);
	await BundleTx.destroy(options);
}

export async function saveBundleArr(data: IBundleData[], dbTx: Transaction) : Promise<void> {
	for (let i = 0; i < data.length; i++) {
		const bundle = data[i];
		const created = await BundleTx.create(bundle.bundlerTx, {
			transaction: dbTx,
		});
		bundle.bundlerTxId = created.id;
		await saveBundleData(bundle, dbTx);
	}
}

export async function saveBundleData(data: IBundleData, dbTx: Transaction) : Promise<void> {
	for (let i = 0; i < data.aaTxArr.length; i++) {
		const iaaTx = data.aaTxArr[i];
		iaaTx.bundleTxId = data.bundlerTxId;
		iaaTx.epoch = data.bundlerTx.epoch;
		iaaTx.bundlerId = data.bundlerTx.bundlerId;
		iaaTx.entryPointId = data.bundlerTx.entryPointId;
	}

	for (let i = 0; i < data.accountDeployedArr.length; i++) {
		data.accountDeployedArr[i].epoch = data.bundlerTx.epoch;
		data.accountDeployedArr[i].bundleTxId = data.bundlerTxId;
	}

	for (let i = 0; i < data.revertReasonArr.length; i++) {
		data.revertReasonArr[i].epoch = data.bundlerTx.epoch;
		data.revertReasonArr[i].bundleTxId = data.bundlerTxId;
	}

	await AATx.bulkCreate(data.aaTxArr, {
		transaction: dbTx,
	});
	await UserOperationRevertReason.bulkCreate(data.revertReasonArr, {
		transaction: dbTx,
	});
	await AccountDeployed.bulkCreate(data.accountDeployedArr, {
		transaction: dbTx,
	});
}

async function syncEpoch(cfx: Conflux, ep: number, blockTime: Date) : Promise<void> {
	if (!blockTime) {
		const blockHashArr = await cfx.getBlocksByEpochNumber(ep);
		const block = await cfx.getBlockByHash(blockHashArr.pop());
		blockTime = new Date(block.timestamp * 1000);
	}
	console.log(`block time `, blockTime.toLocaleString());

	const r = await cfx.getEpochReceipts(ep);
	console.log(`epoch receipts ${r.length}`);
	const txFn = (hash: string)=>{
		return cfx.getTransactionByHash(hash);
	}
	const dbAction = await sync4337txOfEpoch({receipts: r, blocks:null, blockTime, txFn});
	await AATx.sequelize.transaction(async tx => {
		return dbAction.save(tx);
	});
}

export interface ISync4337txParam {
	receipts: TransactionReceipt[][];
	blocks: Block[];
	blockTime:Date;
	txFn?: (hash: string) => Promise<SdkTx>;
}

async function buildRevertReason(log, bundler: IBundleData, blockTime: Date) {
	const revertReason = parseUserOperationRevertReason(log);
	if (revertReason) {
		bundler.revertReasonArr.push({
			bundleTxId: 0n,
			eventContractId: BigInt(await makeIdV(revertReason.address)),
			createdAt: blockTime, epoch: 0n,
			id: 0n, nonce: revertReason.nonce.toString(),
			revertReason: revertReason.revertReason,
			sender: revertReason.sender,
			userOpHash: revertReason.userOpHash,
		})

		bundler.hasData = true;
	}
}

async function buildAATx(event: IUserOperationEvent, blockTime: Date, parsed4337call: I4337call, bundler: IBundleData) {
	const userOp = await buildAATxDBModel(event, blockTime);
	const parsed7702call = parsed4337call?.userOps?.[bundler.aaTxArr.length]?.parsedUserOp;
	userOp.method7702 = parsed7702call?.method ?? '';
	userOp.methods = await build7702methodIds(parsed7702call, blockTime);
	bundler.hasData = true;
	bundler.aaTxArr.push(userOp);
}

async function buildAccountDeployed(bundler: IBundleData, accDeployed: IAccountDeployedEvent, blockTime: Date) {
	bundler.accountDeployedArr.push({
		bundleTxId: 0n,
		eventContractId: BigInt(await makeIdV(accDeployed.address)),
		createdAt: blockTime, epoch: 0n,
		factory: accDeployed.factory, id: 0n,
		paymaster: accDeployed.paymaster,
		sender: accDeployed.sender,
		userOpHash: accDeployed.userOpHash,
	})
	bundler.hasData = true;
}

export async function sync4337txOfEpoch({receipts, blocks, blockTime, txFn}:ISync4337txParam): Promise<IDBAction> {
	const bundleArr: IBundleData[] = [];
	let blockIdx = -1;
	for (const rcptOfBlock of receipts) {
		blockIdx ++;
		let txIdx = -1;
		// console.log(`block rcpts ${rcptOfBlock.length}`);
		for (const rcpt of rcptOfBlock) {
			txIdx ++;
			// console.log(`event count [${rcpt.logs?.length ?? rcpt}]`);
			const rawTxToId = await makeIdV(rcpt.to, null, {dt: blockTime});
			const isTxToEntrypoint = entrypointAddrIdSet.has(rawTxToId);
			if (!isTxToEntrypoint) {
				continue;
			}
			const rawTx = blocks ? (blocks[blockIdx].transactions[txIdx]) as SdkTx : await txFn(rcpt.transactionHash);
			const parsed4337call = parseAATxMethods(rawTx?.data || '0x', format.hexAddress(rcpt.to));
			// Only treat as a bundle tx if the calldata decoded to a known bundling method (handleOps etc.)
			// Calls like depositTo, addStake, balanceOf also go to EntryPoint but are not bundles.
			if (!parsed4337call) {
				console.log(`skip non-bundle EntryPoint tx epoch=${rcpt.epochNumber} hash=${rcpt.transactionHash}`);
				continue;
			}
			const bundler:IBundleData = {
				bundlerTxId: BigInt(0),
				bundlerTx: null,
				aaTxArr: [],
				accountDeployedArr: [],
				revertReasonArr: [],
				hasData: true,
				parsed4337call,
			} as IBundleData;

			for (const log of rcpt.logs) {
				const event = parseUserOperationEvent(log);
				if (event) {
					// console.log(`it's user op`);
					await buildAATx(event, blockTime, parsed4337call, bundler);
					continue;
				}

				const accDeployed = parseAccountDeployed(log);
				if (accDeployed) {
					await buildAccountDeployed(bundler, accDeployed, blockTime);
					continue;
				}

				await buildRevertReason(log, bundler, blockTime);
			}

			let failedTxCount = bundler.aaTxArr.filter(tx => !tx.success).length;
			if (rcpt.outcomeStatus == 1 && parsed4337call?.userOps.length) {
				//build from tx data since there is no event for failed tx.
				for (let i = 0; i < parsed4337call.userOps.length; i++) {
					const op = parsed4337call.userOps[i];
					const aaTx: IAATx = {
						actualGasCost: "0",
						actualGasUsed: "0",
						bundleTxId: 0n,
						bundlerId: 0,
						createdAt: blockTime,
						entryPointId: rawTxToId,
						epoch: BigInt(rcpt.epochNumber),
						eventContractId: 0,
						id: 0n,
						method7702: op.parsedUserOp?.method ?? '',
						methods: await build7702methodIds(op.parsedUserOp, blockTime),
						nonce: op.nonce.toString(),
						paymasterId: await makeIdV(getPaymasterAddress(op.paymasterAndData), null, {dt: blockTime}),
						senderId: await makeIdV(op.sender, null, {dt: blockTime}),
						success: false,
						userOpHash: await readOpHash(
							getCfxSdk(),
							format.hexAddress(rcpt.to),
							op.rawData,
						),
					}
					bundler.aaTxArr.push(aaTx);
				}
				// all failed
				failedTxCount = bundler.aaTxArr.length;
			}
			bundler.bundlerTx = {
				method: parsed4337call.method,
				failedTxCount: failedTxCount,
				status: rcpt.outcomeStatus,
				hash: rcpt.transactionHash,
				epoch: BigInt(rcpt.epochNumber),
				bundlerId: await makeIdV(rcpt.from, null, {dt: blockTime}).then(res => BigInt(res ?? 0)),
				entryPointId: await makeIdV(rcpt.to, null, {dt: blockTime}).then(res => BigInt(res ?? 0)),
				txCount: bundler.aaTxArr.length,
				value: formatEther(rawTx?.value ?? 0),
				txnFee: formatEther(rcpt.gasFee),
				createdAt: blockTime,
			} as IBundleTx;

			bundleArr.push(bundler);
		}
	}
	return {
		save: dbTx => saveBundleArr(bundleArr, dbTx)
	} as IDBAction
}

async function testQuery(target: string) {
	const page = {skip: 0, limit: 10};
	if (!target || target === 'bundle') {
		const bundles = await queryBundleTx({...page});
		console.log(`bundles `, JSON.stringify(bundles, null, 4));
	}
	if (!target || target === 'aa') {
		const aaTxs = await queryAATx({...page});
		await fillAATxMethodInfo(aaTxs.list);
		console.log(`aa TX:\n`, JSON.stringify(aaTxs, null, 4));
	}
}

async function testBundleParser(cfx: Conflux, hash: string) {
	// net 71: example of [send eth, approve, transfer]
	hash = hash || '0x7cdb4307680f46e75b4280d5424eb1002b3e3feadaa70543b4f11791c2006332';
	console.log('parsing bundle tx:', hash, ' net ', cfx.networkId);
	const result = await parseBundleTxByHash(cfx, hash);
	if (!result) {
		console.log('not a 4337 bundle or tx not found');
		return;
	}
	const {userOps, ...bundle} = result;
	console.log('bundle:', JSON.stringify(bundle, null, 2));
	for (const op of userOps) {
		console.log(`  userOp[${op.position}]:`, JSON.stringify(op, null, 4));
	}
}


/**
 * Find epochs that have transactions to any EntryPoint in address_tx but are absent
 * from bundleTx, then re-sync each missing epoch using syncEpoch.
 *
 * Usage:
 *   node stat/service/eip/eip4337.js fixMissing [fromEpoch] [toEpoch]
 *
 * fromEpoch / toEpoch are optional. If omitted the full history is scanned.
 */
async function fixMissingAATx(cfx: Conflux, fromEpoch?: number, toEpoch?: number): Promise<void> {
	// Resolve each entrypoint address to its DB id.
	const entrypointIds: number[] = [];
	for (const addr of entrypointAddrSet) {
		const id = await makeIdV(addr, null, {dt: new Date()});
		if (id != null) entrypointIds.push(id as number);
	}
	if (entrypointIds.length === 0) {
		console.log('No entrypoint ids found in DB — nothing to fix.');
		return;
	}
	console.log(`Entrypoint DB ids: ${entrypointIds.join(', ')}`);

	// Build where clause for epoch range.
	const epochWhere: any = { toId: { [Op.in]: entrypointIds } };
	if (fromEpoch != null) epochWhere.epoch = { ...(epochWhere.epoch ?? {}), [Op.gte]: fromEpoch };
	if (toEpoch   != null) epochWhere.epoch = { ...(epochWhere.epoch ?? {}), [Op.lte]: toEpoch };

	// Fetch all distinct epochs from address_tx that point to an entrypoint.
	const rows = await AddressTransactionIndex.findAll({
		where: epochWhere,
		attributes: ['epoch'],
		group: ['epoch'],
		order: [['epoch', 'ASC']],
		raw: true,
	}) as any[];

	const candidateEpochs: number[] = rows.map(r => Number(r.epoch));
	console.log(`Found ${candidateEpochs.length} candidate epoch(s) in address_tx.`);
	if (candidateEpochs.length === 0) return;

	// Find which of those epochs already have a bundleTx record.
	const existing = await BundleTx.findAll({
		where: { epoch: { [Op.in]: candidateEpochs } },
		attributes: ['epoch'],
		group: ['epoch'],
		raw: true,
	}) as any[];
	const existingSet = new Set(existing.map(r => Number(r.epoch)));

	const missing = candidateEpochs.filter(e => !existingSet.has(e));
	console.log(`${missing.length} epoch(s) missing from bundleTx — will re-sync.`);

	let fixed = 0;
	for (const epoch of missing) {
		try {
			console.log(`[${fixed + 1}/${missing.length}] Syncing epoch ${epoch}...`);
			await syncEpoch(cfx, epoch, null);
			fixed++;
		} catch (e) {
			console.error(`  Failed epoch ${epoch}:`, e);
		}
	}
	console.log(`Done. Fixed ${fixed}/${missing.length} epochs.`);
}

export async function setupEntrypointIds() {
	const isEVM = await KV.getSwitch(IS_EVM2);
	if (!isEVM) {
		return;
	}
	//setup 4337 addresses
	for (const s of entrypointAddrSet) {
		entrypointAddrIdSet.add(await makeIdV(s, null, {dt: new Date()}));
	}
}

/*
npx tsc && node stat/service/eip/eip4337.js syncEpoch 252704270
npx tsc && node stat/service/eip/eip4337.js syncEpoch 250247030 // failed tx
npx tsc && node stat/service/eip/eip4337.js fixMissing               // scan all history
npx tsc && node stat/service/eip/eip4337.js fixMissing 250000000     // from epoch
npx tsc && node stat/service/eip/eip4337.js fixMissing 250000000 252000000  // range
npx tsc && node stat/service/eip/eip4337.js testQuery          // both
npx tsc && node stat/service/eip/eip4337.js testQuery bundle   // bundle txs only
npx tsc && node stat/service/eip/eip4337.js testQuery aa       // aa txs only
npx tsc && node stat/service/eip/eip4337.js testParseFunc
npx tsc && node stat/service/eip/eip4337.js testBundleParser [txHash]
npx tsc && node stat/service/eip/eip4337.js testAATxDetail <userOpHash>
 */
async function main() {
	const [,,cmd,arg1] = process.argv;
	if (cmd === 'syncEpoch') {
		const cfg = await init();
		const cfx = await initCfxSdk(cfg.conflux);
		await setupEntrypointIds();
		await syncEpoch(cfx, parseInt(arg1), null);
	} else if (cmd === 'fixMissing') {
		const [,,,, fromEpochStr, toEpochStr] = process.argv;
		const cfg = await init();
		const cfx = await initCfxSdk(cfg.conflux);
		await setupEntrypointIds();
		const fromEpoch = fromEpochStr ? parseInt(fromEpochStr) : undefined;
		const toEpoch   = toEpochStr   ? parseInt(toEpochStr)   : undefined;
		console.log(`fixMissing fromEpoch=${fromEpoch ?? 'all'} toEpoch=${toEpoch ?? 'all'}`);
		await fixMissingAATx(cfx, fromEpoch, toEpoch);
	} else if (cmd === 'testQuery') {
		const cfg = await init();
		const cfx = await initCfxSdk(cfg.conflux);
		new ContractQuery({cfx, config: cfg.verification});
		await testQuery(arg1);
	} else if (cmd === 'testParseFunc') {
		const cfg = loadConfig('Prod');
		const cfx = await initCfxSdk(cfg.conflux);
		//net 71, example of [send eth, approve, transfer].
		// let hash = '0x7cdb4307680f46e75b4280d5424eb1002b3e3feadaa70543b4f11791c2006332'
		// net 71, failed example
		let hash = '0x8b57795528ebd9fc3828890a15db6631db8169dd58f62bd2b98b84c468bded1e'
		const tx = await cfx.getTransactionByHash(hash);
		console.log('tx:', hash, ' net ', cfx.networkId);
		await testParse4337Func(tx.data, tx.to);
	} else if (cmd === 'testBundleParser') {
		const cfg = loadConfig('Prod');
		const cfx = await initCfxSdk(cfg.conflux);
		await testBundleParser(cfx, arg1);
	} else if (cmd === 'testAATxDetail') {
		const cfg = await init();
		const cfx = await initCfxSdk(cfg.conflux);
		new ContractQuery({cfx, config: cfg.verification});
		const detail = await getAATxDetail(cfx, arg1);
		console.log('AA tx detail:\n', JSON.stringify(detail, null, 4));
	} else {
		console.log(`unknown cmd: ${cmd}`);
	}

	await AATx.sequelize?.close();
	process.exit(0);
}
/*
 drop table bundleTx;
 drop table aaTx;
 drop table account_deployed;
 drop table revert_reason;

 failed AA:
 https://etherscan.io/tx/0x7a354f5cdad936218e06c83bf0737732f9cdbd4a52b51991ee35daf3f7d00285#eventlog
 */

if (require.main == module) {
	main().then();
}
