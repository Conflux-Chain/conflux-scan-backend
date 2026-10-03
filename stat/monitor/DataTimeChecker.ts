import {BOOLEAN, QueryTypes, Sequelize} from "sequelize";
import {KV} from "../model/KV";
import {init} from "../service/tool/FixDailyTokenStat";
import {dingMsg} from "./Monitor";
import {ConfigInstance} from "../config/StatConfig";
import {DataTimeTableList} from "./DataTimeTables";

const moment = require('moment');


// 1. 配置数据库连接
let sequelize: Sequelize;

/**
 * 判定为断更的滞后阈值。
 *
 * 原先写成 `const oneDayAgo = moment().subtract(2, 'days')` —— 变量名说一天、
 * 实际两天，而告警文案又写死"一天前"。三处各说一套，排查时无从判断到底落后多久。
 */
const STALE_AFTER_DAYS = 2;

// 2. 报警函数
function sendAlert(tableName, lastRecord, recordTime) {
	// 带上真实滞后时长：原先是写死的"一天前"，无论落后 2 天还是 5 个月都一样，
	// 看告警的人必须自己去查表才知道严重程度
	const lagHours = moment().diff(recordTime, 'hours');
	const days = Math.floor(lagHours / 24), hours = lagHours % 24;
	const lagText = days
		? (hours ? `${days} 天 ${hours} 小时` : `${days} 天`)
		: `${lagHours} 小时`;
	const msg = `[ALERT] 表 ${tableName} 的最后一条记录已滞后 ${lagText}`
		+ `（阈值 ${STALE_AFTER_DAYS} 天，最后记录时间 ${recordTime.format('YYYY-MM-DD HH:mm:ss')}）!`;
	console.error(msg);
	console.error(`记录详情:`, JSON.stringify(lastRecord, null, 2));
	// 这里可以加入邮件、短信等报警逻辑
	if (sendAlert0) {
		dingMsg(msg, ConfigInstance.dingDevToken).then()
	}
}

// 3. 获取所有表名
async function getAllTables(schema: string) {
	const [results] = await sequelize.query(
		"SELECT table_name FROM information_schema.tables WHERE table_schema = ?",
		{
			replacements: [schema],
			// logging: console.log,
		}
	);
	return results.map(r => {
		// console.log(`row `, r);
		return r["TABLE_NAME"];
	}).filter(BOOLEAN);
}

// 4. 检查单个表
async function checkTable(schema, tableName:string) {
	try {
		const cfgEntry = DataTimeTableList[tableName] || DataTimeTableList[tableName.toLowerCase()];
		const isBakTable = tableName.endsWith("_bak");
		if (!cfgEntry) {
			ignoreCount ++;
			if (!isBakTable) {
				console.log(`table without config: `, tableName);
			}
			return;
		}
		if (cfgEntry.ignore || isBakTable) {
			ignoreCount ++;
			return;
		}

		// 获取主键信息
		const primaryKeys = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.key_column_usage 
      WHERE table_schema = ? 
      AND table_name = ? 
      AND constraint_name = 'PRIMARY'
    `, {
			type: QueryTypes.SELECT,
			replacements: [schema, tableName]
		});

		if (primaryKeys.length === 0) {
			console.log(`表 ${tableName} 没有主键，跳过检查`);
			return;
		}
		// console.log(`primaryKeys: ${primaryKeys}`);
		const primaryKey = primaryKeys[0]["COLUMN_NAME"];

		// 检查是否有 createdAt 列
		const columns = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = ? 
      AND table_name = ? 
      AND column_name = 'createdAt'
    `, {
			type: QueryTypes.SELECT,
			replacements: [schema, tableName]
		});
		const timeCol = cfgEntry?.time || 'createdAt'
		if (columns.length === 0 && !timeCol) {
			if (showNonTimeTable) {
				console.log(`表 ${tableName} 没有 createdAt 列，跳过检查`);
			}
			return;
		}

		// 直接尝试获取最后一条记录（按主键倒序）
		const [lastRecord] = await sequelize.query(`select ${timeCol} from ${tableName} order by ${primaryKey} desc limit 1`,
			{type: QueryTypes.SELECT},
		);

		if (!lastRecord) {
			if(showEmptyTable){
				console.log(`表 ${tableName} 无数据`);
			}
			return;
		}

		const createdAt = lastRecord[timeCol];
		if (!createdAt) {
			console.log(`表 ${tableName} 最后一条记录没有 createdAt 值`);
			return;
		}

		const staleBefore = moment().subtract(STALE_AFTER_DAYS, 'days');
		const recordTime = moment(createdAt);

		if (recordTime.isBefore(staleBefore)) {
			delayedCount ++;
			sendAlert(tableName, lastRecord, recordTime);
		} else {
			normalCount ++;
			if (showNormalTable) {
				console.log(`表 ${tableName} 最后记录时间正常: ${recordTime.format()}`);
			}
		}
	} catch (error) {
		/*
		 * 不再 rethrow。原先一张表出错会冒泡到 checkAllTableDataTime 的 try，
		 * 中断整个 for 循环 —— 排在它后面的表全部不再被检查，而唯一的痕迹是一行
		 * "主流程出错"。一个配置失误就能让监控静默失明，且失明范围取决于
		 * information_schema 返回的表顺序。
		 *
		 * 典型触发条件：某张表配了 ignore:false 但没有 createdAt 列，又没给
		 * `time` 覆盖（unique_addr 就是这种情况）。
		 */
		errorCount ++;
		console.error(`检查表 ${tableName} 时出错（跳过该表，继续检查其余）:`, error.message);
	}
}

// 5. 主函数
async function main() {
	const cfg = await init();
	await checkAllTableDataTime().finally(async ()=>{
		await sequelize.close();
	});
}

export async function checkAllTableDataTime() {
	reset();
	sequelize = KV.sequelize;
	const schema = ConfigInstance.databaseRW.instanceName;
	try {
		const tables = await getAllTables(schema);
		tableCount = tables.length;
		// console.log(`需要检查的表: ${tables.join(', ')}`);

		for (const table of tables) {
			await checkTable(schema, table);
		}
		console.log(`table count: ${tableCount} , ignore ${ignoreCount} , normal count: ${normalCount}, delayed count: ${delayedCount}, error count: ${errorCount}`);
	} catch (error) {
		console.error('主流程出错:', error);
	}
}

function reset() {
	tableCount = 0;
	ignoreCount = 0;
	normalCount = 0;
	delayedCount = 0;
	errorCount = 0;
}

let showEmptyTable = false;
let showNonTimeTable = true;
let showNormalTable = false;
let tableCount = 0;
let ignoreCount = 0;
let normalCount = 0;
let delayedCount = 0;
let errorCount = 0;
let sendAlert0 = true;

if (module === require.main) {
	// 运行主函数
	sendAlert0 = false;
	main().catch(console.error);
}
// node stat/monitor/DataTimeChecker.js
