import {Op, QueryTypes} from 'sequelize'
import {FullBlock, FullTransaction} from "../../model/FullBlock";
import {DailyBlockDataStat} from "../../model/DailyBlockDataStat";
import {fmtDtUTC} from "../../model/Utils";
import {StatType, TimerStat} from "./TimerStat";
import {KEY_EVICTED_STAT_BLOCK_DATA, KV} from "../../model/KV";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class StatDailyBlockData extends TimerStat{

    constructor(app: any, interval: number = 1000 * 60) {
        super(app);
        this.baseInterval = StatType.MIN;
        this.schedule(interval).then();
    }

    public bizAlias(): string {
        return `${DailyBlockDataStat.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyBlockDataStat.findOne({
            where: {statType: this.baseInterval},
            order:[["statTime","desc"]],
            limit: 1
        });
        return this.getStatRangeMin(lastStat, 1);
    }

    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        return FullTransaction.findOne({
            attributes:['epoch'],
            where: {createdAt: {[Op.gte]: rangeEnd}},
            order:[['createdAt', 'asc']],
            limit: 1
        }).then(item => item?.epoch);
    }

    public async stat(rangeBegin: Date, rangeEnd: Date){
        const mStat = await this.statRaw(rangeBegin, rangeEnd);
        const hStat = await this.statAnalysis(rangeEnd, StatType.MIN, StatType.HOUR, mStat);
        const dStat = await this.statAnalysis(rangeEnd, StatType.MIN, StatType.DAY, mStat);

        const statArray = [mStat, hStat, dStat];
        await DailyBlockDataStat.sequelize.transaction(async (dbTx) => {
            await DailyBlockDataStat.destroy({
                where: {statType: hStat.statType, statTime: hStat.statTime}, transaction: dbTx,
            });
            await DailyBlockDataStat.destroy({
                where: {statType: dStat.statType, statTime: dStat.statTime}, transaction: dbTx,
            });
            await DailyBlockDataStat.bulkCreate(statArray, {
                transaction: dbTx,
            });
        });

        await this.evict();
    }

    // ------------------------------- biz -----------------------------------
    private async statRaw(beginTime: Date, endTime: Date): Promise<DailyBlockDataStat> {
        const { intervalType, intervalSec } = this.supportInterval(beginTime, endTime, this.baseInterval);

        const blockSql = `SELECT SUM(difficulty) AS difficultySum, COUNT(*) AS blockCount FROM full_block 
                WHERE createdAt >= ? and createdAt < ?`;
        const blockStat = await FullBlock.sequelize.query(blockSql, { type: QueryTypes.SELECT, raw: true,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
        });
        const txSql = `SELECT COUNT(*) AS txCount FROM full_tx WHERE createdAt >= ? and createdAt < ?`;
        const txStat = await FullTransaction.sequelize.query(txSql, { type: QueryTypes.SELECT, raw: true,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
        });

        const statTime = beginTime;
        const blockCount = BigFixed(blockStat[0]['blockCount']);
        const txCount = BigFixed(txStat[0]['txCount']);
        const difficultySum = BigFixed(blockStat[0]['difficultySum'] || 0);

        const blockTime = blockCount.isZero() ? BigFixed(0) : BigFixed(intervalSec).div(blockCount);
        const hashRate = difficultySum.div(BigFixed(intervalSec));
        const difficulty = blockCount.isZero() ? BigFixed(0) : difficultySum.div(blockCount);
        const tps = txCount.div(BigFixed(intervalSec));

        return {
            statTime, statType: intervalType,
            difficultySum, blockCount, txCount,
            blockTime, hashRate, difficulty, tps
        } as DailyBlockDataStat;
    }

    private async statAnalysis(endTime: Date, srcStatType: StatType, destStatType: StatType,
                               latestStat = undefined): Promise<DailyBlockDataStat> {
        const beginTime = this.getRangeBegin(endTime, destStatType);
        const intervalSec = BigFixed((endTime.getTime() - beginTime.getTime())/1000);

        const statSql = `SELECT statTime,statType,blockCount,txCount,difficultySum FROM daily_block_data_stat 
                    WHERE statType = '${srcStatType}' and statTime >= ? and statTime < ?` ;
        const statList = await DailyBlockDataStat.sequelize.query(statSql, { type: QueryTypes.SELECT, raw: true,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
        });
        if(latestStat) {
            statList.push(latestStat);
        }

        const statTime = beginTime;
        let blockCount = BigFixed(0);
        let txCount = BigFixed(0);
        let difficultySum = BigFixed(0);
        lodash.forEach(statList, stat => {
            blockCount = blockCount.add(BigFixed(stat['blockCount']));
            txCount = txCount.add(BigFixed(stat['txCount']));
            difficultySum = difficultySum.add(BigFixed(stat['difficultySum']));
        });

        const blockTime = blockCount.isZero() ? BigFixed(0) : intervalSec.div(blockCount);
        let difficulty = BigFixed(0);
        let hashRate = BigFixed(0);
        lodash.forEach(statList, stat => {
            difficulty = blockCount.isZero() ? BigFixed(0)
                : difficulty.add(BigFixed(stat['difficultySum']).div(blockCount));
            hashRate = hashRate.add(BigFixed(stat['difficultySum']).div(intervalSec));
        });
        const tps = txCount.div(intervalSec);

        return {statTime, statType: destStatType,
            difficultySum, blockCount, txCount,
            blockTime, hashRate, difficulty, tps
        } as DailyBlockDataStat;
    }

    private async evict() {
        for (const statType of [StatType.MIN, StatType.HOUR]) {
            const stat = await DailyBlockDataStat.findOne({
                where: {statType},
                order: [["statTime", "desc"]],
                offset: this.KEEP_ROWS,
                limit: 1,
                raw: true,
            });

            if (!stat) {
                continue;
            }

            const key = `${KEY_EVICTED_STAT_BLOCK_DATA}_${statType.toUpperCase()}`
            let evicted = await KV.getNumber(key, 0);

            while (true) {
                let rows = 0;

                await DailyBlockDataStat.sequelize.transaction(async (dbTx) => {
                    rows = await DailyBlockDataStat.destroy({
                        transaction: dbTx,
                        where: {
                            statType,
                            id: {[Op.lte]: stat.id},
                        },
                        limit: this.EVICT_ROWS_PER_TIME,
                    });

                    if (rows) {
                        evicted += rows;
                        await KV.saveNumber(key, evicted, dbTx);
                    }
                })

                if (!rows) {
                    break;
                }
            }
        }
    }
}
