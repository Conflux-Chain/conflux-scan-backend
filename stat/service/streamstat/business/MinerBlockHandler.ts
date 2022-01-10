import {StatApp} from "../../../StatApp";
import {StatHandler} from "../StatHandler";
import {BizStatInfo} from "../BizStatInfo";
import {STREAM_STAT_MINER_BLOCK_Q} from "../../RedisWrap";
import {Op, QueryTypes} from "sequelize";
import {StatBucket} from "../StatBucket";
import {Epoch} from "../../../model/Epoch";
import {MinerBlockStat} from "../../../model/MinerBlockStat";

const lodash = require('lodash');

export class MinerBlockHandler extends StatHandler {
    protected app: StatApp;
    protected statLatestDays: number;

    public constructor(app: any) {
        super(app);
        this.app = app;
        this.statLatestDays = 7;
        this.bizQueue = STREAM_STAT_MINER_BLOCK_Q;
        this.bizStatInfo = new BizStatInfo();
    }

    public bizAlias(): string {
        return "miner_block";
    }

    public async warmUp({reservedBuckets}) {
        const checkpoint = new Date();
        checkpoint.setMinutes(0, 0, 0);
        checkpoint.setHours(checkpoint.getHours() - reservedBuckets);

        const total = await MinerBlockStat.count({where: {statTime: {[Op.gte]: checkpoint}, statType: '1h'}});
        if (!total) return;
        let skip = 0;
        let pageSize = 10;
        let curPage = 1;

        do {
            const statArray = await MinerBlockStat.findAll({
                where: {statTime: {[Op.gte]: checkpoint}, statType: '1h'},
                offset: skip, limit: pageSize, raw: true,
            });
            if (statArray === null) return;

            for (const stat of statArray) {
                const statEndTime = new Date(stat.statTime);
                statEndTime.setMinutes(0, 0, 0);
                statEndTime.setHours(statEndTime.getHours() + 1);
                const bucket = new StatBucket({
                    bizValue0: BigInt(stat.blockCntr),
                    bizValue1: BigInt(stat.rewardSum),
                    bizValue2: BigInt(stat.txFeeSum),
                    bizValue3: BigInt(stat.difficultySum),
                    lowerBoundInclude: stat.statTime,
                    upperBoundExclude: statEndTime,
                    minEpochNumber: stat.minEpoch,
                    maxEpochNumber: stat.maxEpoch
                });

                let bucketArray = this.bizStatInfo.statRecords[stat.bizId];
                if (!bucketArray) {
                    bucketArray = [bucket];
                    this.bizStatInfo.statRecords[stat.bizId] = bucketArray;
                } else {
                    bucketArray.push(bucket);
                    this.bizStatInfo.statRecords[stat.bizId] = lodash.orderBy(bucketArray, ['lowerBoundInclude'], ['asc']);
                }
            }
            skip = (++curPage - 1) * pageSize;
        } while (skip <= total);
    }

    public async rollupBucket({statId, bucketArray, reservedBuckets}) {
        do {
            const oldest = bucketArray[0];
            const record = {
                bizId: statId,
                statType: '1h',
                statTime: oldest.lowerBoundInclude,
                blockCntr: oldest.bizValue0,
                rewardSum: oldest.bizValue1,
                txFeeSum: oldest.bizValue2,
                difficultySum: oldest.bizValue3,
                minEpoch: oldest.minEpochNumber,
                maxEpoch: oldest.maxEpochNumber,
            };

            await MinerBlockStat.upsert(record as MinerBlockStat);
            bucketArray.shift();
        } while (bucketArray.length > reservedBuckets);
    }

    public async loadBucket({statId, statTime, statEpoch}) {
        let stat = null;
        if (statTime !== undefined) {
            const searchTime = new Date(statTime);
            searchTime.setMinutes(0, 0, 0);
            stat = await MinerBlockStat.findOne({
                where: {bizId: statId, statType: '1h', statTime: searchTime},
                raw: true,
            });
        }

        if (statEpoch !== undefined) {
            stat = await MinerBlockStat.findOne({
                where: {
                    bizId: statId,
                    statType: '1h',
                    minEpoch: {[Op.lte]: statEpoch},
                    maxEpoch: {[Op.gte]: statEpoch}
                },
                raw: true,
            });
        }

        if (!stat) {
            return stat;
        }

        const statEndTime = new Date(stat.statTime);
        statEndTime.setMinutes(0, 0, 0);
        statEndTime.setHours(statEndTime.getHours() + 1);

        return new StatBucket({
            bizValue0: BigInt(stat.blockCntr),
            bizValue1: BigInt(stat.rewardSum),
            bizValue2: BigInt(stat.txFeeSum),
            bizValue3: BigInt(stat.difficultySum),
            lowerBoundInclude: stat.statTime,
            upperBoundExclude: statEndTime,
            minEpochNumber: stat.minEpoch,
            maxEpochNumber: stat.maxEpoch
        });
    }

    public async collectBucket() {
        const trigger = this.bizStatInfo.trigger();
        if (!trigger) return;

        const latestEpoch = await Epoch.findOne({order: [['epoch', 'desc']], limit: 1})
        const statEnd = latestEpoch.timestamp;
        for (const i of lodash.range(this.statLatestDays)) {
            const statDays = this.statLatestDays - i;
            const {rangeBegin, rangeEnd} = MinerBlockHandler.getStatRange({statEnd, statDays});
            const total = await MinerBlockStat.count({
                where: {[Op.and]: [{statTime: {[Op.gte]: rangeBegin}}, {statTime: {[Op.lt]: rangeEnd}}, {statType: '1h'}]}
            });
            if (!total) continue;

            let skip = 0;
            let pageSize = 10;
            let curPage = 1;
            do {
                const statArray = await MinerBlockStat.findAll({
                    where: {[Op.and]: [{statTime: {[Op.gte]: rangeBegin}}, {statTime: {[Op.lt]: rangeEnd}}, {statType: '1h'}]},
                    offset: skip, limit: pageSize, raw: true,
                });
                if (!statArray) break;

                for (const statDay of statArray) {
                    await this.doStat({bizId: statDay.bizId, statEnd, statDays: 7});
                    if (statDays <= 3) {
                        await this.doStat({bizId: statDay.bizId, statEnd, statDays: 3});
                    }
                    if (statDays <= 1) {
                        await this.doStat({bizId: statDay.bizId, statEnd, statDays: 1});
                    }
                }
                skip = (++curPage - 1) * pageSize;
            } while (skip <= total);
        }
    }

    private static getStatRange({statEnd, statDays}): { rangeBegin: Date, rangeEnd: Date } {
        const rangeBegin = new Date(statEnd);
        rangeBegin.setDate(statEnd.getDate() - statDays);
        const rangeEnd = new Date(statEnd);
        rangeEnd.setDate(statEnd.getDate() - (statDays - 1));
        return {rangeBegin, rangeEnd};
    }

    private async doStat({bizId, statEnd, statDays}) {
        const statType = `${statDays}d`;
        const statBegin = new Date(statEnd);
        statBegin.setDate(statEnd.getDate() - statDays);
        const stat = await MinerBlockStat.findOne({where: {bizId, statType, statTime: statBegin}, raw: true});
        if (stat !== null) return;

        const sql = `select sum(blockCntr) as statBlockCntr,
                            sum(rewardSum) as statRewardSum,
                            sum(txFeeSum) as statTxFeeSum,
                            sum(difficultySum) as statDifficultySum,
                            min(minEpoch) as statMinEpoch,
                            max(maxEpoch) as statMaxEpoch
                     from stat_miner_block
                     where bizId = ?
                       and statTime >= ?
                       and statTime < ?
                       and statType = '1h'`;
        const statNDaysInfo = await MinerBlockStat.sequelize.query(sql,
            {type: QueryTypes.SELECT, replacements: [bizId, statBegin, statEnd]}
        ).then(arr => {
            const item = arr[0];
            return {
                bizId,
                statType,
                statTime: statBegin,
                blockCntr: item['statBlockCntr'],
                rewardSum: item['statRewardSum'],
                txFeeSum: item['statTxFeeSum'],
                difficultySum: item['statDifficultySum'],
                minEpoch: item['statMinEpoch'],
                maxEpoch: item['statMaxEpoch'],
            };
        });

        await MinerBlockStat.sequelize.transaction(async (dbTx) => {
            if (statDays === this.statLatestDays) {
                await MinerBlockStat.destroy({
                    where: {bizId, statType: '1h', statTime: {[Op.lt]: statBegin}}, transaction: dbTx
                });
            }
            await MinerBlockStat.destroy({where: {bizId, statType}, transaction: dbTx});
            await MinerBlockStat.create(statNDaysInfo, {transaction: dbTx});
        });
    }
}