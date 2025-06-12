//
import {DataTypes, Model, Sequelize} from "sequelize";
import {FullBlock, FullTransaction} from "./model/FullBlock";
import {buildGeneralDaily} from "./service/UniqueAddressStat";

export interface ITxSenderHourly {
	id?: number;
	timeStart: Date;
	timeEnd: Date;
	addrId: number;
	count: number;
	amount: number; // value cfx
}

export class TxSenderHourly extends Model<ITxSenderHourly> implements ITxSenderHourly {
	id?: number;
	timeStart: Date;
	timeEnd: Date;
	addrId: number;
	count: number;
	amount: number;
	static register(sequelize: Sequelize) {
		TxSenderHourly.init({
			id: {type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true},
			timeStart: {type: DataTypes.DATE, allowNull: false},
			timeEnd: {type: DataTypes.DATE, allowNull: false},
			addrId: {type: DataTypes.BIGINT, allowNull: false, },
			count: {type: DataTypes.BIGINT, allowNull: false, },
			amount: {type: DataTypes.DECIMAL(65, 0), allowNull: false, },
		}, {
			tableName: 'tx_sender_hourly', sequelize,
			indexes: [
				{name: 'uk_timeStart_aid', fields: ['timeStart', 'addrId'], unique: true},
			]
		})
	}
}

export interface ITxReceiverHourly extends  ITxSenderHourly {

}

export class TxReceiverHourly extends Model<ITxSenderHourly> implements ITxReceiverHourly {
	id?: number;
	timeStart: Date;
	timeEnd: Date;
	addrId: number;
	count: number;
	amount: number;
	static register(sequelize: Sequelize) {
		TxReceiverHourly.init({
			id: {type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true},
			timeStart: {type: DataTypes.DATE, allowNull: false},
			timeEnd: {type: DataTypes.DATE, allowNull: false},
			addrId: {type: DataTypes.BIGINT, allowNull: false, },
			count: {type: DataTypes.BIGINT, allowNull: false, },
			amount: {type: DataTypes.DECIMAL(65, 0), allowNull: false, },
		}, {
			tableName: 'tx_receiver_hourly', sequelize,
			indexes: [
				{name: 'uk_timeStart_aid', fields: ['timeStart', 'addrId'], unique: true},
			]
		})
	}
}

export interface ITxReceiverDaily extends  ITxSenderHourly {

}

export class TxReceiverDaily extends Model<ITxReceiverDaily> implements ITxReceiverDaily {
	id?: number;
	timeStart: Date;
	timeEnd: Date;
	addrId: number;
	count: number;
	amount: number;
	static register(sequelize: Sequelize) {
		TxReceiverDaily.init({
			id: {type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true},
			timeStart: {type: DataTypes.DATE, allowNull: false},
			timeEnd: {type: DataTypes.DATE, allowNull: false},
			addrId: {type: DataTypes.BIGINT, allowNull: false, },
			count: {type: DataTypes.BIGINT, allowNull: false, },
			amount: {type: DataTypes.DECIMAL(65, 0), allowNull: false, },
		}, {
			tableName: 'tx_receiver_daily', sequelize,
			indexes: [
				{name: 'uk_timeStart_aid', fields: ['timeStart', 'addrId'], unique: true},
			]
		})
	}
}

export interface ITxSenderDaily extends  ITxSenderHourly {

}

export class TxSenderDaily extends Model<ITxSenderDaily> implements ITxSenderDaily {
	id?: number;
	timeStart: Date;
	timeEnd: Date;
	addrId: number;
	count: number;
	amount: number;
	static register(sequelize: Sequelize) {
		TxSenderDaily.init({
			id: {type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true},
			timeStart: {type: DataTypes.DATE, allowNull: false},
			timeEnd: {type: DataTypes.DATE, allowNull: false},
			addrId: {type: DataTypes.BIGINT, allowNull: false, },
			count: {type: DataTypes.BIGINT, allowNull: false, },
			amount: {type: DataTypes.DECIMAL(65, 0), allowNull: false, },
		}, {
			tableName: 'tx_sender_daily', sequelize,
			indexes: [
				{name: 'uk_timeStart_aid', fields: ['timeStart', 'addrId'], unique: true},
			]
		})
	}
}

function buildDailyTxParticipantSql(hourlyModel: typeof TxSenderHourly, dailyModel: typeof TxReceiverDaily) {
	const table = hourlyModel.getTableName();
	const dailyTable = dailyModel.getTableName();
	const senderSql = `select ? as timeStart, ? as timeEnd, 
	addrId, sum(count) as count, sum(amount) as amount , now(), now() from ${table
	} where timeStart between ? and ? group by addrId`;
	return `
        insert into ${dailyTable} (timeStart, timeEnd, addrId, count, amount, createdAt, updatedAt)
            (${senderSql}) on duplicate key update updatedAt = values(updatedAt), count=values(count), amount=values(amount)`;
}

export async function buildTxSenderReceiverHourly() {
	await buildTxSummaryHourly(TxSenderHourly, 'fromId');
	await buildTxSummaryHourly(TxReceiverHourly, 'toId');

	const sqlSender = buildDailyTxParticipantSql(TxSenderHourly, TxSenderDaily);
	await buildGeneralDaily(sqlSender, TxSenderHourly as any, TxSenderDaily as any);

	const sqlReceiver = buildDailyTxParticipantSql(TxReceiverHourly, TxReceiverDaily);
	await buildGeneralDaily(sqlReceiver, TxReceiverHourly as any, TxReceiverDaily as any);
}
export async function buildTxSummaryHourly(saveTable: typeof TxSenderHourly, groupBy: string) {
	// find max bean
	const maxSourceDataBean = await FullBlock.findOne({
		order: [['epoch', 'desc']], limit: 1, raw: true,
	})
	if (!maxSourceDataBean) {
		console.log(`${__filename} no source data found`);
		return;
	}
	let startTime: Date;
	const maxHourly = await saveTable.findOne({
		order: [['timeStart', 'desc']], limit: 1, raw: true,
	})
	if (maxHourly) {
		startTime = maxHourly.timeStart;
		startTime.setHours(startTime.getHours() + 1); // next hour of the previous record.
	} else {
		const now = new Date();
		now.setHours(now.getHours() - (24 * 7 + 1)); // 7 days 1 hour ago
		startTime = now;
		startTime.setMinutes(0, 0, 0);
	}
	const endTimeHour = new Date(startTime);
	endTimeHour.setMinutes(59, 59, 999);
	const table = FullTransaction.getTableName();
	const hourlyTable = saveTable.getTableName();
	let changed = false;
	while (maxSourceDataBean.createdAt >= endTimeHour) {
		const senderSql = `select ? as timeStart, ? as timeEnd, ${groupBy
				} as addrId, count(*) as count, sum(dripValue) as amount , now(), now() from ${table
				} where createdAt between ? and ? and status = 0 group by ${groupBy}`;
		const sql = `
        insert into ${hourlyTable} (timeStart, timeEnd, addrId, count, amount, createdAt, updatedAt)
            (${senderSql}) on duplicate key update updatedAt = values(updatedAt), count=values(count), amount=values(amount)`;
		const result = await TxSenderHourly.sequelize.query(sql, {
			replacements: [startTime, endTimeHour, startTime, endTimeHour],
			logging: (sql , ms) => {
				// console.log(`${__filename} hourly unique addr in one sql (${ms}ms):\n`, sql);
			},
			benchmark: true,
		})
		console.log(`tx hourly for ${hourlyTable}, ${startTime.toISOString()} result `, result);
		//increase the time window
		startTime.setHours(startTime.getHours() + 1);
		endTimeHour.setHours(endTimeHour.getHours() + 1);
		changed = true;
	}
	console.log(`block time not reach , ${maxSourceDataBean.createdAt.toISOString()} < ${endTimeHour.toISOString()}`);
	if (changed) {
		// await topUnique({day: 1});
	}
}
