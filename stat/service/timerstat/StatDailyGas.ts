import {Op, QueryTypes} from 'sequelize'
import {FullBlock, FullTransaction} from "../../model/FullBlock";
import {fmtDtUTC} from "../../model/Utils";
import {StatType, TimerStat} from "./TimerStat";
import {DailyGasStat} from "../../model/DailyGasStat";

const BigFixed = require('bigfixed');

export class StatDailyGas extends TimerStat{

    constructor(app: any, interval: number = 1000 * 60) {
        super(app);
        this.baseInterval = StatType.HOUR;
        this.schedule(interval).then();
    }

    public bizAlias(): string {
        return `${DailyGasStat.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyGasStat.findOne({
            where: {statType: this.baseInterval},
            order:[["statTime","desc"]],
            limit: 1
        });
        return this.getStatRangeMin(lastStat, 60);
    }

    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        return FullTransaction.findOne({
            attributes:['epoch'],
            where: {createdAt: {[Op.gte]: rangeEnd}},
            order:[['createdAt', 'asc']],
            limit: 1
        }).then(item => item?.epoch);
    }

    public async stat(
        rangeBegin: Date,
        rangeEnd: Date
    ){
        const hStat = await this.statRaw(rangeBegin, rangeEnd);
        const dStat = await this.statAnalysis(rangeEnd, StatType.HOUR, StatType.DAY, hStat);
        this.debug && console.log(`step5 hStat:${JSON.stringify(hStat)},dStat:${JSON.stringify(dStat)}`);

        const statArray = [hStat, dStat];
        await DailyGasStat.sequelize.transaction(async (dbTx) => {
            await DailyGasStat.destroy({
                where: {statType: dStat.statType, statTime: dStat.statTime}, transaction: dbTx,
            });
            await DailyGasStat.bulkCreate(statArray, {
                transaction: dbTx,
            });
        });
        this.debug && console.log(`step6 record:${JSON.stringify(statArray)}`);
    }

    // ------------------------------- biz -----------------------------------
    private async statRaw(
        beginTime: Date,
        endTime: Date
    ): Promise<DailyGasStat> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval);

        const blockStats = await FullBlock.sequelize.query(`
             SELECT
                 SUM(gasLimit) gasLimitSum,
                 SUM(gasUsed) gasUsedSum,
                 SUM(txCount * avgGasPrice) gasPriceSum,
                 SUM(txCount) txCount,
                 COUNT(*) blockCount
            FROM full_block
            WHERE
                createdAt >= ?
                AND createdAt < ?
                AND avgGasPrice > 0
            `, {
            type: QueryTypes.SELECT, raw: true,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
        });

        const txStats = await FullTransaction.sequelize.query(`
            SELECT 
                MIN(gasPrice) gasPriceMin, 
                MAX(gasPrice) gasPriceMax
            FROM full_tx 
            WHERE 
                createdAt >= ? 
                AND createdAt < ? 
                AND gasPrice > 0
            `, {
            type: QueryTypes.SELECT, raw: true,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
        });

        const statTime = beginTime;
        const blockCount = BigFixed(blockStats[0]['blockCount'] || 0);
        const txCount = BigFixed(blockStats[0]['txCount'] || 0);
        const gasLimitSum = BigFixed(blockStats[0]['gasLimitSum'] || 0);
        const gasUsedSum = BigFixed(blockStats[0]['gasUsedSum'] || 0);
        const gasPriceSum = BigFixed(blockStats[0]['gasPriceSum'] || 0);

        const gasLimitAvg = blockCount.isZero() ? BigFixed(0) : gasLimitSum.div(blockCount);
        const gasPriceMin = BigFixed(txStats[0]['gasPriceMin'] || 0);
        const gasPriceMax = BigFixed(txStats[0]['gasPriceMax'] || 0);
        const gasPriceAvg = txCount.isZero() ? BigFixed(0) : gasPriceSum.div(txCount);
        const networkUtilization = gasLimitSum.isZero() ? BigFixed(0) : gasUsedSum.div(gasLimitSum);

        return {
            statTime,
            statType: intervalType,

            blockCount,
            txCount,
            gasLimitSum,
            gasUsedSum,
            gasPriceSum,

            gasLimitAvg,
            gasPriceMin,
            gasPriceMax,
            gasPriceAvg,
            networkUtilization,
        } as DailyGasStat;
    }

    private async statAnalysis(
        endTime: Date,
        srcStatType: StatType,
        destStatType: StatType,
        latestStat = undefined
    ): Promise<DailyGasStat> {
        const beginTime = this.getRangeBegin(endTime, destStatType);

        const stats = await DailyGasStat.sequelize.query(`
            SELECT 
                statTime,
                statType,
                blockCount,
                txCount,
                gasLimitSum,
                gasUsedSum,
                gasPriceSum,
                gasPriceMin,
                gasPriceMax
            FROM daily_gas_stat 
            WHERE 
                statType = ? 
                and statTime >= ? 
                and statTime < ?
            `, {
            type: QueryTypes.SELECT, raw: true,
            replacements: [srcStatType, fmtDtUTC(beginTime), fmtDtUTC(endTime)],
        });

        if (latestStat) {
            stats.push(latestStat);
        }

        const statTime = beginTime;
        let blockCount = BigFixed(0);
        let txCount = BigFixed(0);
        let gasLimitSum = BigFixed(0);
        let gasUsedSum = BigFixed(0);
        let gasPriceSum = BigFixed(0);
        let gasPriceMin = BigFixed(stats[0]['gasPriceMin']);
        let gasPriceMax = BigFixed(stats[0]['gasPriceMax']);
        stats.forEach((stat: DailyGasStat) => {
            blockCount = blockCount.add(BigFixed(stat['blockCount']));
            txCount = txCount.add(BigFixed(stat['txCount']));
            gasLimitSum = gasLimitSum.add(BigFixed(stat['gasLimitSum']));
            gasUsedSum = gasUsedSum.add(BigFixed(stat['gasUsedSum']));
            gasPriceSum = gasPriceSum.add(BigFixed(stat['gasPriceSum']));
            const curGasPriceMin = BigFixed(stat['gasPriceMin']);
            const curGasPriceMax = BigFixed(stat['gasPriceMax']);
            gasPriceMin = curGasPriceMin.lt(gasPriceMin) ? curGasPriceMin : gasPriceMin;
            gasPriceMax = curGasPriceMax.gt(gasPriceMax) ? curGasPriceMax : gasPriceMax;
        });

        const gasLimitAvg = blockCount.isZero() ? BigFixed(0) : gasLimitSum.div(blockCount);
        const gasPriceAvg = txCount.isZero() ? BigFixed(0) : gasPriceSum.div(txCount);
        const networkUtilization = gasLimitSum.isZero() ? BigFixed(0) : gasUsedSum.div(gasLimitSum);

        return {
            statTime,
            statType: destStatType,

            blockCount,
            txCount,
            gasLimitSum,
            gasUsedSum,
            gasPriceSum,

            gasLimitAvg,
            gasPriceMin,
            gasPriceMax,
            gasPriceAvg,
            networkUtilization,
        } as DailyGasStat;
    }
}

/*

select
    count(*) blockCount,
    sum(txCount) txCount,
    sum(gasLimit) gasLimitSum,
    sum(gasUsed) gasUsedSum,
    sum(txCount * avgGasPrice) gasPriceSum,
    ROUND(sum(gasLimit)/count(*), 0) as avgGasLimit,
    ROUND(sum(txCount * avgGasPrice)/sum(txCount), 0) as avgGasPrice
from full_block
where
    createdAt >= '2024-03-12'
    and createdAt < '2024-03-13'
    and avgGasPrice > 0;

select
    min(gasPrice) gasPriceMin,
    max(gasPrice) gasPriceMax
from full_tx
where
    createdAt >= '2024-03-12'
    and createdAt < '2024-03-13'
    and gasPrice > 0;

*/

