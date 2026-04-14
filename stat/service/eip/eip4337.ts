import {IUserOperationEvent, parseUserOperationEvent} from "./eip4337abi";
import {AATx, BundleTx, IAATx, IBundleTx} from "../../model/eip4337model";
import {formatEther} from "ethers";
import {makeIdV} from "../../model/HexMap";
import {Transaction} from "sequelize";
import {Conflux} from "js-conflux-sdk";
import {init} from "../tool/FixDailyTokenStat";
import {initCfxSdk} from "../common/utils";

export interface IBundleData {
	bundlerTx: IBundleTx;
	bundlerTxId: bigint;
	aaTxArr: IAATx[];
}

export async function buildDBModel(ops: IUserOperationEvent[], blockTime: Date) : Promise<IAATx[]> {
	const aaTxArr: IAATx[] = [];

	for (let i = 0; i < ops.length; i++){
		const op = ops[i];

		const aaTx: IAATx = {
			actualGasCost: formatEther(op.actualGasCost),
			actualGasUsed: op.actualGasUsed.toString(),
			bundleTxId: 0n,
			createdAt: blockTime,
			epoch: 0n,
			id: 0n,
			nonce: op.nonce,
			paymasterId: await makeIdV(op.paymaster),
			senderId: await makeIdV(op.sender),
			success: op.success,
			userOpHash: op.userOpHash,
		}
		aaTxArr.push(aaTx);
	}

	return aaTxArr;
}

export async function saveBundleArr(data: IBundleData[], dbTx: Transaction) : Promise<void> {
	for (let i = 0; i < data.length; i++) {
		const bundle = data[i];
		const created = await BundleTx.create(bundle.bundlerTx);
		bundle.bundlerTxId = created.id;
		await saveBundleData(bundle, dbTx);
	}
}

export async function saveBundleData(data: IBundleData, dbTx: Transaction) : Promise<void> {
	if (data.aaTxArr.length == 0) {
		console.log(`bundlerTxArr is empty`);
		return;
	}
	console.log(` aa tx count ${data.aaTxArr.length}`);
	for (let i = 0; i < data.aaTxArr.length; i++) {
		data.aaTxArr[i].bundleTxId = data.bundlerTxId;
		data.aaTxArr[i].epoch = data.bundlerTx.epoch;
	}
	await AATx.bulkCreate(data.aaTxArr, {
		transaction: dbTx,
	})
}

export async function syncEpoch(cfx: Conflux, ep: number, blockTime: Date) : Promise<void> {
	if (!blockTime) {
		const blockHashArr = await cfx.getBlocksByEpochNumber(ep);
		const block = await cfx.getBlockByHash(blockHashArr.pop());
		blockTime = new Date(block.timestamp * 1000);
	}
	console.log(`block time `, blockTime.toLocaleString());

	const r = await cfx.getEpochReceipts(ep);
	console.log(`epoch receipts ${r.length}`);

	const bundleArr: IBundleData[] = [];
	for (const rcptOfBlock of r) {
		console.log(`block rcpts ${rcptOfBlock.length}`);
		for (const rcpt of rcptOfBlock) {
			const events = []
			console.log(`event count [${rcpt.logs?.length || rcpt}]`);
			for (const log of rcpt.logs) {
				const event = parseUserOperationEvent(log);
				if (!event) {
					continue;
				}
				console.log(`got event `, event)
				events.push(event);
			}
			if (events.length > 0) {
				const rawTx = await cfx.getTransactionByHash(rcpt.transactionHash);

				const bundleTx = {
					hash: rcpt.transactionHash,
					epoch: BigInt(rcpt.epochNumber),
					bundlerId: await makeIdV(rcpt.from, null, {dt: blockTime}).then(res=>BigInt(res ?? 0)),
					entryPointId: await makeIdV(rcpt.to, null, {dt: blockTime}).then(res=>BigInt(res ?? 0)),
					txCount: events.length,
					value: formatEther(rawTx?.value ?? 0),
					txnFee: formatEther(rcpt.gasFee),
					createdAt: blockTime,
				} as IBundleTx;

				const beanArr = await buildDBModel(events, blockTime);
				bundleArr.push({
					bundlerTxId: BigInt(0),
					bundlerTx: bundleTx,
					aaTxArr: beanArr,
				} as IBundleData);
			}
		}
	}
	await AATx.sequelize.transaction(async tx => {
		return saveBundleArr(bundleArr, tx);
	});
}

async function main() {
	const [,,cmd,arg1] = process.argv;
	if (cmd === 'syncEpoch') {
		const cfg = await init();
		const cfx = await initCfxSdk(cfg.conflux);
		await syncEpoch(cfx, parseInt(arg1), null);

	} else {
		console.log(`unknown cmd: ${cmd}`);
	}

	await AATx.sequelize?.close();
}

if (require.main == module) {
	main().then();
}
