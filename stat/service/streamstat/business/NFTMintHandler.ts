import {StatHandler} from "../StatHandler";
import {BizStatInfo} from "../BizStatInfo";
import {STREAM_STAT_NFT_MINT_Q} from "../../RedisWrap";
import {Op, QueryTypes} from "sequelize";
import {StatBucket} from "../StatBucket";
import {Epoch} from "../../../model/Epoch";
import {NFTMintStat} from "../../../model/NFTMintStat";

const lodash = require('lodash');

export class NFTMintHandler extends StatHandler {
    protected app: any;
    protected statLatestDays: number;

    public constructor(app: any) {
        super(app);
        this.app = app;
        this.statLatestDays = 7;
        this.bizQueue = STREAM_STAT_NFT_MINT_Q;
        this.bizStatInfo = new BizStatInfo();
    }

    public bizAlias(): string {
        return `${NFTMintStat.getTableName()}`;
    }

    public async warmUp({reservedBuckets}) {
        const checkpoint = new Date();
        checkpoint.setMinutes(0, 0, 0);
        checkpoint.setHours(checkpoint.getHours() - reservedBuckets);

        const total = await NFTMintStat.count({where: {statType: '1h', statTime: {[Op.gte]: checkpoint}}});
        if (!total) return;
        let skip = 0;
        let pageSize = 10;
        let curPage = 1;

        do {
            const statArray = await NFTMintStat.findAll({
                where: {statType: '1h', statTime: {[Op.gte]: checkpoint}},
                offset: skip, limit: pageSize, raw: true,
            });
            if (statArray === null) return;

            for (const stat of statArray) {
                const statEndTime = new Date(stat.statTime);
                statEndTime.setMinutes(0, 0, 0);
                statEndTime.setHours(statEndTime.getHours() + 1);
                const bucket = new StatBucket({
                    bizValue0: BigInt(stat.nftAsset),
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
                nftAsset: oldest.nftAsset,
                minEpoch: oldest.minEpochNumber,
                maxEpoch: oldest.maxEpochNumber,
            };

            await NFTMintStat.upsert(record as NFTMintStat);
            bucketArray.shift();
        } while (bucketArray.length > reservedBuckets);
    }

    public async loadBucket({statId, statTime, statEpoch}) {
        let stat = null;
        if (statTime !== undefined) {
            const searchTime = new Date(statTime);
            searchTime.setMinutes(0, 0, 0);
            stat = await NFTMintStat.findOne({
                where: {statType: '1h', bizId: statId, statTime: searchTime},
                raw: true,
            });
        }

        if (statEpoch !== undefined) {
            stat = await NFTMintStat.findOne({
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
            bizValue0: BigInt(stat.nftAsset),
            lowerBoundInclude: stat.statTime,
            upperBoundExclude: statEndTime,
            minEpochNumber: stat.minEpoch,
            maxEpochNumber: stat.maxEpoch
        });
    }

    public async collect() {}

    public async cache() {
        const table = NFTMintStat.getTableName()
        const sql = `
            select tmp.* from
            (
                select tmp1.bizId,
                       sum(nftAsset) as nftAsset,
                       min(minEpoch) as minEpoch,
                       max(maxEpoch) as maxEpoch 
                from (select distinct(bizId) as bizId from ${table} where statType = '1h' and statTime >= :beginTime and statTime < :endTime) tmp1
                left join ${table} tmp2 on tmp1.bizId = tmp2.bizId
                where tmp2.statType = '1h' and tmp2.statTime >= :beginTime and tmp2.statTime < :endTime
                group by tmp1.bizId
            ) tmp 
            order by tmp.nftAsset desc limit 10
        `;

        const statDaysArray = [1, 3, 7];
        const latestEpoch = await Epoch.findOne({order: [['epoch', 'desc']], limit: 1})
        const endTime = latestEpoch.timestamp;
        for (const statDays of statDaysArray) {
            const beginTime = new Date(endTime);
            beginTime.setDate(endTime.getDate() - statDays);
            let list = await NFTMintStat.sequelize.query(sql, {type: QueryTypes.SELECT, replacements: {beginTime, endTime}});

            const {maxTime} = await this.getStatSpan(list);
            list = await this.convertToAddress(list)

            list.forEach(item => {
                delete item['minEpoch'];
                delete item['maxEpoch'];
            });
            this.cacheStatInfo[`${statDays}d`] = {maxTime, list}
        }
    }
}