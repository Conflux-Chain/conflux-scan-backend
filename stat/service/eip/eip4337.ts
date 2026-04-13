import {IUserOperationEvent} from "./eip4337abi";
import {AATx, BundleTx, IAATx, IBundleTx} from "../../model/eip4337model";
import {formatEther} from "ethers";
import {makeIdV} from "../../model/HexMap";
import {Transaction} from "sequelize";

export interface IBundleData {
	bundlerTxArr: IBundleTx[];
	aaTxArr: IAATx[]
}

export async function buildDBModel(ops: IUserOperationEvent[], blockTime: Date) : Promise<IBundleData> {
	const data: IBundleData = {
		bundlerTxArr: [],
		aaTxArr: [],
	}
	for (const op of ops) {
		// const bTx: IBundleTx = {
		//
		// }
		// data.bundlerTxArr.push(bTx);

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
		data.aaTxArr.push(aaTx);
	}

	return data;
}

export async function saveBundleData(data: IBundleData, dbTx: Transaction) : Promise<void> {
	if (data.bundlerTxArr.length == 0) {
		return;
	}
	const beans = await BundleTx.bulkCreate(data.bundlerTxArr, {
		transaction: dbTx,
	});
	//todo set bundle id
	await AATx.bulkCreate(data.aaTxArr, {
		transaction: dbTx,
	})
}
