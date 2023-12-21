import {StatHandler} from "../StatHandler";
import {BizStatInfo} from "../BizStatInfo";
import {STREAM_STAT_MINER_BLOCK_Q} from "../../RedisWrap";
import {Op, QueryTypes} from "sequelize";
import {StatBucket} from "../StatBucket";
import {Epoch} from "../../../model/Epoch";
import {MinerBlockStat} from "../../../model/MinerBlockStat";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class MinerBlockHandler extends StatHandler {
    protected app: any;
    protected statLatestDays: number;

    public constructor(app: any) {
        super(app);
        this.app = app;
        this.statLatestDays = 7;
        this.bizQueue = STREAM_STAT_MINER_BLOCK_Q;
        this.bizStatInfo = new BizStatInfo();
    }

    public bizAlias(): string {
        return `${MinerBlockStat.getTableName()}`;
    }

    public async warmUp({reservedBuckets}) {
        const checkpoint = new Date();
        checkpoint.setMinutes(0, 0, 0);
        checkpoint.setHours(checkpoint.getHours() - reservedBuckets);

        const total = await MinerBlockStat.count({where: {statType: '1h', statTime: {[Op.gte]: checkpoint}}});
        if (!total) return;
        let skip = 0;
        let pageSize = 10;
        let curPage = 1;

        do {
            const statArray = await MinerBlockStat.findAll({
                where: {statType: '1h', statTime: {[Op.gte]: checkpoint}},
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
                where: {statType: '1h', bizId: statId, statTime: searchTime},
                raw: true,
            });
        }

        if (statEpoch !== undefined) {
            stat = await MinerBlockStat.findOne({
                where: {
                    statType: '1h',
                    bizId: statId,
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

    public async collect() {}

    public async cache() {
        const table = MinerBlockStat.getTableName()
        const sql = `
            select tmp.* from
            (
                select tmp1.bizId,
                       sum(blockCntr) as blockCntr,
                       sum(rewardSum) as rewardSum,
                       sum(txFeeSum) as txFeeSum,
                       sum(difficultySum) as difficultySum,
                       min(minEpoch) as minEpoch,
                       max(maxEpoch) as maxEpoch 
                from (select distinct(bizId) as bizId from ${table} where statType = '1h' and statTime >= :beginTime and statTime < :endTime) tmp1
                left join ${table} tmp2 on tmp1.bizId = tmp2.bizId
                where tmp2.statType = '1h' and tmp2.statTime >= :beginTime and tmp2.statTime < :endTime
                group by tmp1.bizId
            ) tmp 
            order by tmp.blockCntr desc limit 10
        `;

        const statDaysArray = [1, 3, 7];
        const latestEpoch = await Epoch.findOne({order: [['epoch', 'desc']], limit: 1})
        const endTime = latestEpoch.timestamp;
        for (const statDays of statDaysArray) {
            const beginTime = new Date(endTime);
            beginTime.setDate(endTime.getDate() - statDays);
            let list = await MinerBlockStat.sequelize.query(sql, {type: QueryTypes.SELECT, replacements: {beginTime, endTime}});

            list = await this.convertToAddress(list)
            const {minEpochNumber, maxEpochNumber, minTime, maxTime} = await this.getStatSpan(list);
            const difficultyTotal = await MinerBlockStat.sum('difficultySum', {
                where: {statType: '1h', minEpoch: {[Op.gte]: minEpochNumber}, maxEpoch: {[Op.lte]: maxEpochNumber}},
            });
            if(minTime && maxTime){
                const seconds = (new Date(maxTime).getTime() - new Date(minTime).getTime()) / 1000
                list.forEach(item => { item['hashRate'] = BigFixed(item['difficultySum']).div(seconds).toString();});
            }

            const statObjKey = `${statDays}d`
            list.forEach(item => {
                delete item['difficultySum'];
                delete item['minEpoch'];
                delete item['maxEpoch'];
            });
            const statObjVal = {
                maxTime,
                difficultyTotal: difficultyTotal || 0,
                list,
            }
            this.cacheStatInfo[statObjKey] = statObjVal
        }
    }
}