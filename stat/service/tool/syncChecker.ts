import {Conflux} from "js-conflux-sdk";
import {AddressTransactionIndex, FullBlock, FullTransaction, IFullTransaction} from "../../model/FullBlock";
import {loadTxsByEpoch} from "../FullBlockService";
import {makeIdV} from "../../model/HexMap";
import {init} from "./FixDailyTokenStat";
import {initCfxSdk} from "../common/utils";
import {cfxSafeEpochReceipts} from "../../TokenTransferSync";

async function checkEpochTx({cfx, epoch, dryRun}:{cfx: Conflux, epoch: number, dryRun: boolean}) {
	console.log(`check epoch ${epoch}`);
	const rcpts = await cfxSafeEpochReceipts(cfx, epoch);
	const block = await FullBlock.findOne({where: {epoch, pivot: true}});
	const newTxArr = []
	for(let b=0; b<rcpts.length; b++) {
		const txArr = rcpts[b];
		let txPos = 0;
		for (let t = 0; t < txArr.length; t++) {
			const tx = txArr[t];
			if (tx.outcomeStatus != 0 && tx.outcomeStatus != 1) {
				console.log(`skip tx with status ${tx.outcomeStatus}`);
				continue;
			}
			const rawTx = await cfx.getTransactionByHash(tx.transactionHash);
			const mergeTo = tx.to || tx.contractCreated;
			const mergeToId = await makeIdV(mergeTo);
			const newTx: IFullTransaction = {
				epoch,
				blockPosition: b, txPosition: txPos++,
				createdAt: block.createdAt,
				hash: tx.transactionHash,
				fromId: await makeIdV(tx.from),
				nonce: rawTx.nonce,
				toId: mergeToId,
				dripValue: rawTx.value,
				gasPrice: rawTx.gasPrice,
				gas: tx.gasFee,
				status: tx.outcomeStatus,
				contractCreatedId: tx.contractCreated ? mergeToId : 0,
				method: rawTx.data?.substr(0, 10),
			}
			newTxArr.push(newTx);
		}
	}
	const dbTxArr = await loadTxsByEpoch(epoch, null);
	const dbTxMap = new Map<string, FullTransaction>();
	dbTxArr.forEach(tx=>dbTxMap.set(buildTxKey(tx), tx));

	await FullTransaction.sequelize.transaction(async (__dbTx)=>{
		for(const newTx of newTxArr) {
			const dbTx = dbTxMap.get(buildTxKey(newTx));

			const thatDbTxOpt = {transaction: __dbTx};
			const insertOp = async ()=>{
				await FullTransaction.create(newTx, thatDbTxOpt);
				await AddressTransactionIndex.create({addressId: newTx.fromId, ...newTx}, thatDbTxOpt)
				if (newTx.fromId != newTx.toId) {
					await AddressTransactionIndex.create({addressId: newTx.toId, ...newTx}, thatDbTxOpt)
				}
				console.log(`created`)
			}

			if (!dbTx) {
				console.log(`db tx is absent, block ${newTx.blockPosition} txPos ${newTx.txPosition} hash ${newTx.hash}`);

				!dryRun && await insertOp();
			} else if (dbTx.hash != newTx.hash) {
				console.log(`hash mismatch  , block ${newTx.blockPosition} txPos ${newTx.txPosition} new hash ${newTx.hash} , db hash ${dbTx.hash}`);
				if (dryRun) {
					continue;
				}

				const ids = [dbTx.fromId];
				if (dbTx.fromId != dbTx.toId) {
					ids.push(dbTx.toId);
				}
				await Promise.all(ids.map(addrId=>{
					return AddressTransactionIndex.destroy({where: {
						addressId: dbTx.fromId, epoch: dbTx.epoch, blockPosition: dbTx.blockPosition, txPosition: dbTx.txPosition},
						transaction: __dbTx,
					});
				}))
				await FullTransaction.destroy({where: {
					epoch: dbTx.epoch, blockPosition: dbTx.blockPosition, txPosition: dbTx.txPosition},
					transaction: __dbTx,
				});
				console.log(`deleted`)
				await insertOp();
			} else {
				console.log(`matched        , block ${newTx.blockPosition} txPos ${newTx.txPosition} hash ${newTx.hash}`);
			}
		}
	})
	console.log(`finished, epoch ${epoch}`)
}
function buildTxKey(tx: IFullTransaction) {
	return `${tx.blockPosition}_${tx.txPosition}`
}
async function main() {
	const cfg = await init();
	const cfx = await initCfxSdk(cfg.blockSyncRpc);
	const [,,cmd,arg1, arg2] = process.argv;
	if (cmd == 'fixTx') {
		await checkEpochTx({cfx, epoch: parseInt(arg1), dryRun: arg2 != 'doIt'});
	} else {
		console.log(`unknown cmd [${cmd}]`)
	}
	await FullTransaction.sequelize.close();
}

if (module == require.main) {
	main().then()
}

// node stat/service/tool/syncChecker.js fixTx 0 dryRun
