import {BOOLEAN, QueryTypes, Sequelize} from "sequelize";
import {KV} from "../model/KV";
import {init} from "../service/tool/FixDailyTokenStat";
import {dingMsg} from "./Monitor";
import {ConfigInstance} from "../config/StatConfig";

const moment = require('moment');

const tableConfig = {
	'abi_info': {ignore: true },
	'abi_stub': {ignore: true },
	'address_cfx_transfer_2': {ignore: true },
	'address_erc1155transfer_3': {ignore: true },
	'address_erc721transfer_3': {ignore: true },
	'address_erc20transfer_3': {ignore: true },
	'address_nft_transfer': {ignore: true },
	'address_nfts': {ignore: true },
	'addr_event_3525': {ignore: true },
	'api_log': {ignore: true },
	'address_tx': {ignore: true },
	'approval_relation': {ignore: true },
	'cfx_balance': {ignore: true },
	'contract': {ignore: true },
	'contract_abi': {ignore: true },
	'contract_verify': {ignore: true },
	'event_3525': {ignore: true },
	'erc1155_addr_amount': {ignore: true },
	'erc1155_data': {ignore: true },
	'erc1155transfer_3': {ignore: true },
	'erc721transfer_3': {ignore: true },
	'error_log': {ignore: true },
	'e_space_hex40': {ignore: true },
	'full_tx_row_mark': {ignore: true },
	'name_tag': {ignore: true },
	'owner_count': {ignore: true },
	'nft_metadata': {ignore: true },
	'nft_balance': {ignore: true },
	'nft_metadata_fts': {ignore: true },
	'nft_mint_2': {ignore: true },
	'nft_transfer': {ignore: true },
	'prune_info': {ignore: true },
	'hex40': {ignore: true },
	'pos_account': {ignore: true },
	'slot_changed_3525': {ignore: true },
	'rate_config': {ignore: true },
	'rate_hit': {ignore: true },
	'req_account': {ignore: true },
	'task_cfx_transfer': {ignore: true },
	'task_event_3525': {ignore: true },
	'task_token_transfer_3': {ignore: true },
	'task_approval': {ignore: true },
	'token': {ignore: true },
	'token_approval': {ignore: true },
	'token_balance': {ignore: true },
	'token_security_audit': {ignore: true },
	'token_slot_3525': {ignore: true },
	'result_cache': {ignore: true },
	'proxy_verify': {ignore: true },
	'full_miner_block': {ignore: true },
	'block_row_mark': {ignore: true },
	'cfx_transfer_row_mark_2': {ignore: true },
	'cfx_user': {ignore: true },
	'check_epoch_info': {ignore: true },
	'config': {ignore: true },
	'contract_destroy': {ignore: true },
	'contract_user': {ignore: true },
	'epoch_nft_transfer': {ignore: true },
	'full_block_ext': {ignore: true },
	'heart_beat': {ignore: true },
	'hex64': {ignore: true },
	'lock': {ignore: true },
	'epoch': {ignore: true, key: 'epoch' , time: 'timestamp' },
	'pos_account_block': {ignore: true,  },
	'pos_register': {ignore: true,  },
	'slot_3525': {ignore: true,  },
	'trace_create_contract': {ignore: true,  },
	'tx_failed': {ignore: true,  },
	'testTimezone': {ignore: true,  },
	'transfer_count': {ignore: true,  },
	'unique_addr': {ignore: false, time: 'timeStart'  },
	'vote_params': {ignore: true, time: 'timestamp'  },
	'minerblock': {ignore: false, time: 'beginTime'  },
}

// 1. 配置数据库连接
let sequelize: Sequelize;
// 2. 报警函数
function sendAlert(tableName, lastRecord) {
	const msg = `[ALERT] 表 ${tableName} 的最后一条记录创建于一天前!`;
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
		if (tableConfig[tableName]?.ignore || tableName.endsWith("_bak")) {
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
		const timeCol = tableConfig[tableName]?.time || tableConfig[tableName.toLowerCase()]?.time || 'createdAt'
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

		// 检查时间是否是一天前
		const oneDayAgo = moment().subtract(2, 'days');
		const recordTime = moment(createdAt);

		if (recordTime.isBefore(oneDayAgo)) {
			delayedCount ++;
			sendAlert(tableName, lastRecord);
		} else {
			normalCount ++;
			if (showNormalTable) {
				console.log(`表 ${tableName} 最后记录时间正常: ${recordTime.format()}`);
			}
		}
	} catch (error) {
		console.error(`检查表 ${tableName} 时出错:`, error.message);
		throw error;
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
		console.log(`table count: ${tableCount} , ignore ${ignoreCount} , normal count: ${normalCount}, delayed count: ${delayedCount}`);
	} catch (error) {
		console.error('主流程出错:', error);
	}
}

function reset() {
	tableCount = 0;
	ignoreCount = 0;
	normalCount = 0;
	delayedCount = 0;
}

let showEmptyTable = false;
let showNonTimeTable = true;
let showNormalTable = false;
let tableCount = 0;
let ignoreCount = 0;
let normalCount = 0;
let delayedCount = 0;
let sendAlert0 = true;

if (module === require.main) {
	// 运行主函数
	sendAlert0 = false;
	main().catch(console.error);
}
// node stat/monitor/DataTimeChecker.js
