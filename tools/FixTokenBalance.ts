import { Op, Transaction, Sequelize } from 'sequelize';
import {Erc1155Data} from "../stat/model/Token";
import {TokenBalance} from "../stat/model/Balance";
import {init} from "../stat/service/tool/FixDailyTokenStat";

// 统计信息接口
interface ProcessStats {
  totalContracts: number;
  totalAddresses: number;
  totalRecords: number;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  startTime: number;
}

// 游标位置接口
interface CursorPosition {
  contractId: number;
  addressId: number;
}

/**
 * 获取下一个要处理的合约ID
 */
async function getNextContractId(lastContractId: number): Promise<number | null> {
  const nextContract = await Erc1155Data.findOne({
    attributes: ['contractId'],
    where: {
      contractId: { [Op.gt]: lastContractId }
    },
    order: [['contractId', 'ASC']],
    raw: true
  });

  return nextContract ? Number(nextContract.contractId) : null;
}

/**
 * 获取下一个要处理的地址ID
 */
async function getNextAddressId(contractId: number, lastAddressId: number): Promise<number | null> {
  const nextAddress = await Erc1155Data.findOne({
    attributes: ['addressId'],
    where: {
      contractId,
      addressId: { [Op.gt]: lastAddressId }
    },
    order: [['addressId', 'ASC']],
    raw: true
  });

  return nextAddress ? Number(nextAddress.addressId) : null;
}

/**
 * 获取指定合约和地址的记录数
 */
async function getRecordCount(contractId: number, addressId: number, transaction: Transaction): Promise<bigint> {
  const count = await Erc1155Data.count({
    where: { contractId, addressId },
    transaction
  });
  return BigInt(count);
}

/**
 * 查询现有的TokenBalance记录
 */
async function findExistingTokenBalance(
  contractId: number,
  addressId: number,
  transaction: Transaction
): Promise<TokenBalance | null> {
  return await TokenBalance.findOne({
    where: { contractId, addressId },
    transaction
  });
}

/**
 * 插入新的TokenBalance记录
 */
async function insertTokenBalance(
  contractId: number,
  addressId: number,
  balance: bigint,
  transaction: Transaction
): Promise<void> {
  await TokenBalance.create({
    contractId,
    addressId,
    balance
  }, { transaction });
}

/**
 * 更新TokenBalance记录
 */
async function updateTokenBalance(
  tokenBalance: TokenBalance,
  newBalance: bigint,
  oldBalance: bigint,
  transaction: Transaction
): Promise<void> {
  await tokenBalance.update({
    balance: newBalance
  }, { transaction });
}

/**
 * 处理单个合约+地址组合
 */
async function processAddressPair(
  contractId: number,
  addressId: number,
  stats: ProcessStats
): Promise<void> {
  const transaction = await sequelize.transaction();

  try {
    // 获取当前记录数
    const currentCount = await getRecordCount(contractId, addressId, transaction);

    // 查询现有记录
    const existingBalance = await findExistingTokenBalance(contractId, addressId, transaction);

    if (!existingBalance) {
      // 没有记录，执行插入
      console.log(`  [INSERT] contractId=${contractId}, addressId=${addressId}, balance=${currentCount}`);
      await insertTokenBalance(contractId, addressId, currentCount, transaction);
      stats.insertedCount++;
    } else {
      // 有记录，比较balance
      const oldBalance = existingBalance.balance;

      if (oldBalance !== currentCount) {
        // balance不一致，执行更新
        console.log(`  [UPDATE] contractId=${contractId}, addressId=${addressId}, old=${oldBalance}, new=${currentCount}`);
        await updateTokenBalance(existingBalance, currentCount, oldBalance, transaction);
        stats.updatedCount++;
      } else {
        // balance一致，不做操作
        console.log(`  [UNCHANGED] contractId=${contractId}, addressId=${addressId}, balance=${currentCount}`);
        stats.unchangedCount++;
      }
    }

    await transaction.commit();

    // 更新统计信息
    stats.totalAddresses++;
    stats.totalRecords += Number(currentCount);

  } catch (error) {
    await transaction.rollback();
    console.error(`  处理失败 contractId=${contractId}, addressId=${addressId}:`, error);
    throw error;
  }
}

/**
 * 处理单个合约下的所有地址
 */
async function processContract(
  contractId: number,
  stats: ProcessStats
): Promise<void> {
  console.log(`\n[合约 ${++stats.totalContracts}] 处理合约 ID: ${contractId}`);

  let currentAddressId = 0;
  let contractAddressCount = 0;
  let contractRecordCount = 0;

  while (true) {
    // 获取下一个地址ID
    const addressId = await getNextAddressId(contractId, currentAddressId);

    if (!addressId) {
      console.log(`  合约 ${contractId} 处理完成，共 ${contractAddressCount} 个地址，${contractRecordCount} 条记录`);
      break;
    }

    contractAddressCount++;

    // 处理这个地址
    const beforeAddressStats = { ...stats };
    await processAddressPair(contractId, addressId, stats);

    // 计算这个地址处理的记录数
    const addressRecords = stats.totalRecords - beforeAddressStats.totalRecords;
    contractRecordCount += addressRecords;

    // 更新当前地址ID
    currentAddressId = addressId;

    // 每处理10个地址显示一次进度
    if (contractAddressCount % 10 === 0) {
      const elapsedSeconds = (Date.now() - stats.startTime) / 1000;
      console.log(`    进度: 已处理 ${contractAddressCount} 个地址，累计 ${stats.totalRecords} 条记录，耗时 ${elapsedSeconds.toFixed(2)}秒`);
    }
  }
}

/**
 * 打印统计信息
 */
function printStats(stats: ProcessStats): void {
  const elapsedSeconds = (Date.now() - stats.startTime) / 1000;

  console.log('\n========================================');
  console.log('处理完成统计信息：');
  console.log('========================================');
  console.log(`处理合约数: ${stats.totalContracts}`);
  console.log(`处理地址数: ${stats.totalAddresses}`);
  console.log(`总记录数: ${stats.totalRecords}`);
  console.log(`插入记录数: ${stats.insertedCount}`);
  console.log(`更新记录数: ${stats.updatedCount}`);
  console.log(`未变化记录数: ${stats.unchangedCount}`);
  console.log(`总耗时: ${elapsedSeconds.toFixed(2)} 秒`);
  console.log(`平均处理速度: ${(stats.totalAddresses / elapsedSeconds).toFixed(2)} 地址/秒`);
  console.log('========================================');
}

/**
 * 主处理函数 - 使用动态游标方式
 */
export async function updateTokenBalancesDynamic(): Promise<void> {
  const stats: ProcessStats = {
    totalContracts: 0,
    totalAddresses: 0,
    totalRecords: 0,
    insertedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    startTime: Date.now()
  };

  try {
    console.log('开始动态游标方式处理 TokenBalance...');
    console.log('时间: ', new Date().toLocaleString());

    let currentContractId = 0;

    while (true) {
      // 获取下一个合约ID
      const contractId = await getNextContractId(currentContractId);

      if (!contractId) {
        console.log('没有更多合约需要处理');
        break;
      }

      // 处理这个合约
      await processContract(contractId, stats);

      // 更新当前合约ID
      currentContractId = contractId;

      // 每个合约处理后显示进度
      const elapsedSeconds = (Date.now() - stats.startTime) / 1000;
      console.log(`\n当前进度: 已完成 ${stats.totalContracts} 个合约，${stats.totalAddresses} 个地址，耗时 ${elapsedSeconds.toFixed(2)}秒`);
    }

    // 打印最终统计信息
    printStats(stats);

  } catch (error) {
    console.error('处理失败:', error);

    // 在失败时也打印部分统计信息
    console.log('\n失败时的统计信息：');
    printStats(stats);

    throw error;
  }
}

/**
 * 带断点续传功能的版本
 */
export async function updateTokenBalancesWithResume(
  resumeFrom?: CursorPosition
): Promise<void> {
  const stats: ProcessStats = {
    totalContracts: 0,
    totalAddresses: 0,
    totalRecords: 0,
    insertedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    startTime: Date.now()
  };

  try {
    console.log('开始带断点续传的处理...');
    console.log('时间: ', new Date().toLocaleString());

    if (resumeFrom) {
      console.log(`从断点恢复: contractId=${resumeFrom.contractId}, addressId=${resumeFrom.addressId}`);
    }

    let currentContractId = resumeFrom?.contractId || 0;
    let skipFirstContract = !!resumeFrom;

    while (true) {
      // 获取下一个合约ID
      const contractId = await getNextContractId(currentContractId);

      if (!contractId) {
        console.log('没有更多合约需要处理');
        break;
      }

      // 如果是断点恢复的合约，需要从指定地址开始
      if (skipFirstContract && resumeFrom && contractId === resumeFrom.contractId) {
        console.log(`从断点地址开始处理合约 ${contractId}`);

        // 处理当前合约，从断点地址之后开始
        let currentAddressId = resumeFrom.addressId;

        while (true) {
          const addressId = await getNextAddressId(contractId, currentAddressId);

          if (!addressId) break;

          await processAddressPair(contractId, addressId, stats);
          currentAddressId = addressId;
        }

        stats.totalContracts++;
        skipFirstContract = false;
      } else {
        // 正常处理整个合约
        await processContract(contractId, stats);
      }

      currentContractId = contractId;

      // 可选：保存检查点
      // await saveCheckpoint({ contractId, addressId: 0 });
    }

    printStats(stats);

  } catch (error) {
    console.error('处理失败:', error);
    console.log('\n失败时的统计信息：');
    printStats(stats);
    throw error;
  }
}

/**
 * 极致优化版本 - 使用原生SQL
 */
export async function updateTokenBalancesUltimate(): Promise<void> {
  const stats: ProcessStats = {
    totalContracts: 0,
    totalAddresses: 0,
    totalRecords: 0,
    insertedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    startTime: Date.now()
  };

  console.log('开始极致优化版本处理...');
  console.log('时间: ', new Date().toLocaleString());

  let lastContractId = 0;
  let lastAddressId = 0;

  try {
    while (true) {
      // 使用原生SQL获取下一个要处理的组合
      const [nextPair]: any[] = await sequelize.query(`
        SELECT contractId, addressId 
        FROM erc1155_data 
        WHERE (contractId > :lastContractId) 
           OR (contractId = :lastContractId AND addressId > :lastAddressId)
        ORDER BY contractId ASC, addressId ASC
        LIMIT 1
      `, {
        replacements: { lastContractId, lastAddressId }
      });

      if (!nextPair || nextPair.length === 0) {
        console.log('没有更多数据需要处理');
        break;
      }

      const { contractId, addressId } = nextPair[0];

      // 处理这个组合
      const transaction = await sequelize.transaction();

      try {
        // 获取记录数
        const [countResult]: any[] = await sequelize.query(`
          SELECT COUNT(*) as count 
          FROM erc1155_data 
          WHERE contractId = :contractId AND addressId = :addressId
        `, {
          replacements: { contractId, addressId },
          transaction
        });

        const currentCount = BigInt(countResult[0].count);

        // 查询现有记录
        const [existing]: any[] = await sequelize.query(`
          SELECT balance FROM token_balances 
          WHERE contractId = :contractId AND addressId = :addressId
        `, {
          replacements: { contractId, addressId },
          transaction
        });

        if (!existing || existing.length === 0) {
          // 插入新记录
          console.log(`  [INSERT] contractId=${contractId}, addressId=${addressId}, balance=${currentCount}`);

          await sequelize.query(`
            INSERT INTO token_balances (contractId, addressId, balance, createdAt, updatedAt)
            VALUES (:contractId, :addressId, :balance, NOW(), NOW())
          `, {
            replacements: {
              contractId,
              addressId,
              balance: currentCount.toString()
            },
            transaction
          });

          stats.insertedCount++;

        } else {
          const oldBalance = BigInt(existing[0].balance);

          if (oldBalance !== currentCount) {
            // 更新记录
            console.log(`  [UPDATE] contractId=${contractId}, addressId=${addressId}, old=${oldBalance}, new=${currentCount}`);

            await sequelize.query(`
              UPDATE token_balances 
              SET balance = :balance, updatedAt = NOW()
              WHERE contractId = :contractId AND addressId = :addressId
            `, {
              replacements: {
                contractId,
                addressId,
                balance: currentCount.toString()
              },
              transaction
            });

            stats.updatedCount++;
          } else {
            // 未变化
            console.log(`  [UNCHANGED] contractId=${contractId}, addressId=${addressId}, balance=${currentCount}`);
            stats.unchangedCount++;
          }
        }

        await transaction.commit();

        // 更新统计信息
        stats.totalAddresses++;
        stats.totalRecords += Number(currentCount);

        // 更新游标
        lastContractId = contractId;
        lastAddressId = addressId;

        // 每处理100个组合显示一次进度
        if (stats.totalAddresses % 100 === 0) {
          const elapsedSeconds = (Date.now() - stats.startTime) / 1000;
          console.log(`进度: 已处理 ${stats.totalAddresses} 个组合，插入:${stats.insertedCount} 更新:${stats.updatedCount} 未变:${stats.unchangedCount}，耗时:${elapsedSeconds.toFixed(2)}秒`);
        }

      } catch (error) {
        await transaction.rollback();
        console.error(`处理组合 contractId=${contractId}, addressId=${addressId} 失败:`, error);
        throw error;
      }
    }

    printStats(stats);

  } catch (error) {
    console.error('处理失败:', error);
    console.log('\n失败时的统计信息：');
    printStats(stats);
    throw error;
  }
}

let sequelize: Sequelize;
/**
 * 主函数
 */
async function main() {
  await init();
  sequelize = TokenBalance.sequelize;
  try {
    console.log('开始执行 TokenBalance 更新任务...');

    // 选择适合的方式
    // 方式1: 基础动态版本
    // await updateTokenBalancesDynamic();

    // 方式2: 带断点续传版本
    await updateTokenBalancesWithResume({ contractId: 0, addressId: 0 });

    // 方式3: 极致优化版本（推荐用于超大数据集）
    // await updateTokenBalancesUltimate();

  } catch (error) {
    console.error('执行失败:', error);
    process.exit(1);
  }
}

// 执行主函数
if (require.main === module) {
  main().then(() => process.exit(0));
}
