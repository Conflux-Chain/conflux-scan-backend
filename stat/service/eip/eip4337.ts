import {
	IUserOperationEvent,
	parseAccountDeployed,
	parseUserOperationEvent,
	parseUserOperationRevertReason
} from "./eip4337abi";
import {
	AATx, AccountDeployed,
	BundleTx,
	IAATx,
	IAccountDeployed,
	IBundleTx,
	IUserOperationRevertReason,
	UserOperationRevertReason
} from "../../model/eip4337model";
import {formatEther} from "ethers";
import {makeIdV} from "../../model/HexMap";
import {Transaction} from "sequelize";
import {Conflux} from "js-conflux-sdk";
import {init} from "../tool/FixDailyTokenStat";
import {initCfxSdk} from "../common/utils";
import {queryAATx, queryBundleTx} from "./eip4337query";
import {Block, TransactionReceipt, Transaction as SdkTx} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {IDBAction} from "../BatchDBTx";

export interface IBundleData {
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
		eventContractId: await makeIdV(op.address),
		createdAt: blockTime,
		epoch: 0n,
		id: 0n,
		nonce: op.nonce.toString(),
		paymasterId: await makeIdV(op.paymaster),
		senderId: await makeIdV(op.sender),
		bundlerId: 0,
		entryPointId: 0,
		success: op.success,
		userOpHash: op.userOpHash,
	};
}

export async function pop4337data(epoch: number|any, dbTx: Transaction) {
	const options = {where: {epoch} , transaction: dbTx};

	await BundleTx.destroy(options);
	await AATx.destroy(options);
	await UserOperationRevertReason.destroy(options);
	await AccountDeployed.destroy(options);
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

			const bundler:IBundleData = {
				bundlerTxId: BigInt(0),
				bundlerTx: null,
				aaTxArr: [],
				accountDeployedArr: [],
				revertReasonArr: [],
				hasData: false,
			} as IBundleData;

			for (const log of rcpt.logs) {
				const event = parseUserOperationEvent(log);
				if (event) {
					// console.log(`it's user op`);
					const userOp = await buildAATxDBModel(event, blockTime);
					bundler.hasData = true;
					bundler.aaTxArr.push(userOp);
					continue;
				}

				const accDeployed = parseAccountDeployed(log);
				if (accDeployed) {
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
					continue;
				}

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
				} else {
					// console.log(`what's it ?`, log);
				}
			}
			if (bundler.hasData) {
				const rawTx = blocks ? (blocks[blockIdx].transactions[txIdx]) as SdkTx : await txFn(rcpt.transactionHash);

				bundler.bundlerTx = {
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
	}
	return {
		save: dbTx => saveBundleArr(bundleArr, dbTx)
	} as IDBAction
}

async function testQuery() {
	// Query BundleTx with both filters
	const page = {skip: 0, limit: 10};
	const bundles = await queryBundleTx({
		// bundlerId: BigInt(123),
		// entryPointId: BigInt(456),
		...page,
	});
	// console.log(`bundles `, JSON.stringify(bundles, null , 4));

	// Query AATx with sender filter only
	const aaTxs = await queryAATx({
		// senderId: 789,
		...page,
	});
	console.log(`aa TX:\n`, JSON.stringify(aaTxs, null, 4));

	// Query AATx with all three filters
	const filteredTxs = await queryAATx({
		senderId: 789,
		bundlerId: (123),
		entryPointId: (456),
		...page,
	});
}

/*
node stat/service/eip/eip4337.js syncEpoch 250261540
node stat/service/eip/eip4337.js testQuery
 */
async function main() {
	const [,,cmd,arg1] = process.argv;
	if (cmd === 'syncEpoch') {
		const cfg = await init();
		const cfx = await initCfxSdk(cfg.conflux);
		await syncEpoch(cfx, parseInt(arg1), null);
	} else if (cmd === 'testQuery') {
		await init();
		await testQuery();
	} else {
		console.log(`unknown cmd: ${cmd}`);
	}

	await AATx.sequelize?.close();
}
/*
 drop table bundleTx;
 drop table aaTx;
 drop table account_deployed;
 drop table revert_reason;
 */

if (require.main == module) {
	main().then();
}
