import {DataTypes, Model, Op, Sequelize} from "sequelize";
import {getAddrId, Hex40Map, makeIdV} from "../../model/HexMap";
import {format} from "js-conflux-sdk";

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
			hexId: id, hex: format.hexAddress(account), base32: account,
			reqTime: new Date(), regTime: new Date(), inQueue: true,
		}, {});
	}
}

async function checkAccount(reqAcc: ReqAccount) {
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

export async function repeatCheckAccount() {
	const code = await runCheckingTask().catch(e=>{
		console.log(`${__filename}, failed to check`, e)
		return 500;
	})
	setTimeout(repeatCheckAccount, code > 0 ? 10_000 : 0);
}
