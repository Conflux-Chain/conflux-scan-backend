import {DataTypes, Model, Op, QueryTypes, Sequelize} from "sequelize";
import {buildHexSet, getAddrId} from "../../model/HexMap";
import {Conflux, format} from "js-conflux-sdk";
import {CfxWatcher} from "./BalanceWatcher";
import {formatAddr} from "../../../open-api/common/RestTool";
import {AddressErc20Transfer} from "../../model/Erc20Transfer";
import {handleTokenTransferWithContract} from "../../StreamSync";
import {BatchBalanceWatcher} from "./BatchBalanceWatcher";
import {safeAddErrorLog} from "../../monitor/ErrorMonitor";
import {INftMint, NftMint} from "../../model/Token";
import {AddressNfts} from "../../model/AddrNft";
import {Epoch} from "../../model/Epoch";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {fix721addrNftHolder} from "../tool/NftOwnerCheck";

export interface IReqAccount {
	hexId: number; hex: string; base32: string;
	reqTime: Date; checkTime: Date; regTime: Date;
	inQueue: boolean;
}

export class ReqAccount extends Model<IReqAccount> implements IReqAccount {
	hexId: number; hex: string; base32: string;
	reqTime: Date; checkTime: Date;  regTime: Date;
	inQueue: boolean;
	static register(sequelize: Sequelize) {
		ReqAccount.init({
			hexId: {type: DataTypes.BIGINT, primaryKey: true, },
			hex: {type: DataTypes.CHAR(42), allowNull: false,},
			base32: {type: DataTypes.CHAR(64), allowNull: false,},
			reqTime: {type: DataTypes.DATE, allowNull: false,},
			checkTime: {type: DataTypes.DATE, allowNull: true,},
			regTime: {type: DataTypes.DATE, allowNull: false,},
			inQueue: {type: DataTypes.BOOLEAN, allowNull: false,},
		}, {
			sequelize,
			tableName: 'req_account',
			indexes: [
				{name: 'idx_updated', fields: ['updatedAt']},
				{name: 'idx_inQ_regTime', fields: ['inQueue', 'regTime']}
			]
		})
	};
}

export async function safeAddReqAccount(account: string) {
	return addReqAccount(account).catch(e=>{
		console.log(`${__filename} failed to add account request `, e)
	})
}
export async function addReqAccount(account: string) {
	const id = await getAddrId(account);
	if (!id) {
		return
	}
	const bean = await ReqAccount.findByPk(id);
	if (bean) {
		bean.reqTime = new Date();
		if (!bean.inQueue) {
			// enqueue if not
			bean.inQueue = true;
			bean.regTime = bean.reqTime;
		}
		await bean.save();
	} else {
		await ReqAccount.upsert({
			hexId: id, hex: format.hexAddress(account), base32: formatAddr(account),
			reqTime: new Date(), regTime: new Date(), inQueue: true,
		}, {});
	}
}
export async function checkAccount721(accId: number) {
	const sql = `select mint.* from ${NftMint.getTableName()} mint left join ${AddressNfts.getTableName()} a_n
	 on mint.toId = a_n.addressId and mint.contractId=a_n.contractId and mint.tokenId=a_n.tokenId 
	 where mint.toId=${accId} and a_n.addressId is null`;
	const arr = await NftMint.sequelize.query(sql, {type: QueryTypes.SELECT, raw: true, logging: true})
		.then(res=>res as INftMint[]);
	if (arr.length == 0) {
		return;
	}
	const epochSyncMax = await Epoch.findOne({order: [['epoch', 'desc']], raw: true});
	if (!epochSyncMax) {
		return;
	}
	console.log(`mismatch 721 nft , addr ${accId} length ${arr.length}`);
	for (const mint of arr) {
		if (epochSyncMax.epoch < mint.epoch + 20) {
			console.log(`epoch sync not ready, ${epochSyncMax.epoch} < ${mint.epoch}`);
			continue
		}
		const {contractId, epoch, tokenId, toId} = mint;
		const tx = await Erc721Transfer.findOne({where: {
			contractId, epoch, tokenId, toId
		}, raw: true, logging: true});
		if (!tx) {
			console.log(`721 transfer not found,`, mint);
			continue
		}
		await fix721addrNftHolder([tx]);
	}
	console.log(`ok , check 721 of ${accId}`);
}
async function checkAccountBiz(reqAcc: ReqAccount) {
	await cfxWatcher.queryBalance(reqAcc.hex, reqAcc.hexId);
	const [arr20, arr721, arr1155] =  await Promise.all([
		AddressErc20Transfer.findAll(  {where: {addressId: reqAcc.hexId, }, order: [['epoch', 'desc']], limit: 100}),
		// AddressErc721Transfer.findAll( {where: {addressId: reqAcc.hexId, }, order: [['epoch', 'desc']], limit: 100}),
		// AddressErc1155Transfer.findAll({where: {addressId: reqAcc.hexId, }, order: [['epoch', 'desc']], limit: 100}),
	]);
	const cidSet = new Set<number>();
	buildHexSet(cidSet, arr20, 'contractId');
	// buildHexSet(cidSet, arr721, 'contractId');
	// buildHexSet(cidSet, arr1155, 'contractId');
	const map = new Map<number, Set<number>>();
	[...cidSet].forEach(cid=>{
		map.set(cid, new Set<number>([reqAcc.hexId]));
	})
	await handleTokenTransferWithContract(map, cfxWatcher.cfx);
	await checkAccount721(reqAcc.hexId);
}
async function checkAccount(reqAcc: ReqAccount) {
	await checkAccountBiz(reqAcc);
	reqAcc.checkTime = new Date();
	reqAcc.regTime = new Date(reqAcc.reqTime.getTime() + 600_000); // next checking time
	await reqAcc.save();
	console.log(`${__filename} checked ${reqAcc.hexId} ${reqAcc.base32}`);
}

export async function runCheckingTask() {
	const now = new Date();
	const reqAcc = await ReqAccount.findOne({
		where: {inQueue: true, regTime: {[Op.lt]: now}},
		order: [['regTime', 'asc']],
	});
	if (!reqAcc) {
		console.log(`${__filename} no account request`)
		return 404;
	}
	if (!reqAcc.checkTime) {
		await checkAccount(reqAcc);
	} else if (reqAcc.reqTime < reqAcc.checkTime) {
		// no activity after last checkpoint
		reqAcc.inQueue = false;
		console.log(`kick out ${reqAcc.hexId} ${reqAcc.base32}`);
		await reqAcc.save();
	} else {
		// have activities after last checkpoint, and reach the `nextCheckingTime`.
		await checkAccount(reqAcc);
	}
	return 0;
}
 let cfxWatcher: CfxWatcher;
export async function repeatCheckAccount(cfx: Conflux) {
	if (!cfxWatcher) {
		cfxWatcher = new CfxWatcher("accountChecker", cfx);
		new BatchBalanceWatcher(cfx, await BatchBalanceWatcher.getUtilContractAddr());
	}
	const code = await runCheckingTask().catch(e=>{
		safeAddErrorLog(`token-x`, 'auto-check-account', e).then();
		console.log(`${__filename}, failed to check`, e)
		return 500;
	});
	setTimeout(repeatCheckAccount, code > 0 ? 10_000 : 0);
}
