import {DataTypes, Model, Sequelize} from "sequelize";
import {ConfigInstance} from "../config/StatConfig";
import {dingMsg} from "./Monitor";

export interface IErrorLog {
	id: number;
	module: string; // sync, v1, stat, open
	biz: string;
	detail: string;
	count: number;
	updatedAt: Date;
}

export class ErrorLog extends Model<IErrorLog> implements IErrorLog {
	id: number;
	module: string; // sync, v1, stat, open
	biz: string;
	detail: string;
	count: number;
	updatedAt: Date;
	static register(sequelize: Sequelize) {
		ErrorLog.init({
			id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
			module: {type: DataTypes.STRING(128), allowNull: false,},
			biz: {type: DataTypes.STRING(256), allowNull: false,},
			detail: {type: DataTypes.TEXT({length: "tiny"}), allowNull: false,},
			count: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 1},
			updatedAt: {type: DataTypes.DATE, allowNull: false},
		}, {
			sequelize, tableName: 'error_log',
			indexes: [
				{name: 'idx_module_biz', fields: ['module', 'biz'], unique: true},
				{name: 'idx_updatedAt', fields: ['updatedAt']}
			]
		})
	}
}

const alertCtx = {
	lastErrorTime: new Date().getTime() - 3600_000,
}

async function reportError(eLog: ErrorLog) {
	const nowMs = Date.now();
	if (nowMs < alertCtx.lastErrorTime + 3600_000) {
		return;
	}
	alertCtx.lastErrorTime = nowMs;
	if (!ConfigInstance.dingTalkToken) {
		return
	}
	const {module, biz, detail, count: times} = eLog;
	await dingMsg(`There was an error:\nmodule: ${module
	}\nbusiness: ${biz}\ntimes: ${times}\ndetail: ${detail}`, ConfigInstance.dingTalkToken);
}

export async function safeAddErrorLog(module: string, biz: string, error: Error) {
	try {
		await addErrorLog(module, biz, error);
	} catch (e) {
		console.log(`failed to record error`, e)
	}
}

async function addErrorLog(module: string, biz: string, error: Error) {
	if (!ErrorLog.sequelize) {
		return;
	}
	if (biz.length > 256) {
		biz = biz.substring(0, 256);
	}
	let detail = JSON.stringify(error, null, 4);
	if (detail.length < 3) {
		detail = `${error}`;
	}
	if (detail.length < 3) {
		detail = `${error.message}\n${error.stack}`;
	}
	let bean = await ErrorLog.findOne({where: {module, biz}});
	if (bean) {
		bean.count += 1;
		await bean.save();
	} else {
		[bean] = await ErrorLog.upsert({
			module, biz, detail: detail, count: 1,
		})
	}
	await reportError(bean)
}
