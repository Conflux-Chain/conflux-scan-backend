import { Model, ModelStatic, FindOptions, Op } from 'sequelize';
import {ITrace, Trace} from "../stat/model/CfxTransfer";

/**
 * 遍历表并按顺序执行函数
 * @param Model  Sequelize 模型
 * @param processFunction  要执行的函数
 * @param batchSize  每次查询的批次大小（默认1000）
 * @param condition  可选的查询条件
 * @param logInterval  日志打印间隔（默认1000条）
 */
export async function processTableSequentially(
	Model: ModelStatic<Trace>,
	processFunction: (record: any) => Promise<void> | void,
	options?: {
		batchSize?: number;
		condition?: FindOptions;
		logInterval?: number;
		startFromId?: number;
		maxRecords?: number;
	}
): Promise<{
	totalProcessed: number;
	lastProcessedId: number | null;
	startTime: Date;
	endTime: Date;
}> {
	const {
		batchSize = 1000,
		condition = {},
		logInterval = 1000,
		startFromId = 1,
		maxRecords = Infinity
	} = options || {};

	let lastId = startFromId - 1;
	let totalProcessed = 0;
	let lastProcessedId: number | null = null;
	const startTime = new Date();

	try {
		console.log(`开始处理 ${Model.name} 表，批次大小: ${batchSize}，起始ID: ${lastId + 1}`);

		while (totalProcessed < maxRecords) {
			// 构建查询条件：ID 大于上一批的最大值，并按 ID 排序
			const queryOptions: FindOptions = {
				...condition,
				where: {
					...condition.where,
					id: { [Op.gt]: lastId }
				},
				order: [['id', 'ASC']],
				limit: Math.min(batchSize, maxRecords - totalProcessed)
			};

			// 查询当前批次的数据
			const records = await Model.findAll(queryOptions);

			// 如果没有更多数据，结束循环
			if (records.length === 0) {
				console.log('没有更多数据需要处理');
				break;
			}

			// 处理当前批次的每一条记录
			for (const record of records) {
				try {
					// 执行处理函数
					const result = processFunction(record.toJSON());

					// 如果返回 Promise，则等待
					if (result && typeof result.then === 'function') {
						await result;
					}

					totalProcessed++;
					lastProcessedId = record.id;

					// 定期打印日志
					if (totalProcessed % logInterval === 0) {
						console.log(`已处理 ${totalProcessed} 条记录，最后处理的ID: ${lastProcessedId}`);
					}
				} catch (error) {
					console.error(`处理记录 ID ${record.id} 时出错:`, error);
					// 可以选择继续处理或抛出错误
					// throw error; // 如果需要停止处理，取消注释这行
				}
			}

			// 更新最后处理的 ID
			lastId = records[records.length - 1].id;

			console.log(`批次处理完成，当前批次大小: ${records.length}，最后ID: ${lastId}，总计: ${totalProcessed}`);
		}

		const endTime = new Date();
		const duration = endTime.getTime() - startTime.getTime();
		console.log(`处理完成！总共处理 ${totalProcessed} 条记录，耗时 ${duration}ms`);

		return {
			totalProcessed,
			lastProcessedId,
			startTime,
			endTime
		};

	} catch (error) {
		console.error('处理过程中发生错误:', error);
		throw error;
	}
}


/**
 * 简化的遍历函数
 */
export async function iterateTable(
	Model: ModelStatic<Trace>,
	callback: (record: any) => Promise<void> | void,
	startId: number = 1
): Promise<void> {
	let lastId = startId - 1;
	const batchSize = 1000;

	while (true) {
		const records = await Model.findAll({
			where: {
				id: { [Op.gt]: lastId }
			},
			order: [['id', 'ASC']],
			limit: batchSize
		});

		if (records.length === 0) {
			break;
		}

		for (const record of records) {
			try {
				const result = callback(record.toJSON());
				if (result && typeof result.then === 'function') {
					await result;
				}
			} catch (error) {
				console.error(`处理记录 ${record.id} 失败:`, error);
			}
			lastId = record.id;
		}

		console.log(`处理到 ID: ${lastId}`);
	}

	console.log('遍历完成');
}

// 使用示例
async function exampleUsage() {
	// 假设你已经有了 Trace 模型
	// const Trace = sequelize.define('Trace', {...});

	// 示例处理函数
	async function processTrace(trace: any) {
		// 这里写你的处理逻辑
		console.log(`处理 epoch ${trace.epoch}, block ${trace.blockIndex}`);

		// 示例：更新某些字段
		if (trace.input && trace.input.startsWith('0x')) {
			// 执行一些操作
		}
	}

	// 方式1：使用顺序处理
	await processTableSequentially(Trace, processTrace, {
		batchSize: 500,
		logInterval: 100,
		startFromId: 10000,
		condition: {
			where: {
				valid: true,
				epoch: { [Op.gt]: 100 }
			}
		}
	});


	// 方式3：使用简化版本
	await iterateTable(Trace, processTrace, 1);
}

if (module === require.main) {

}
