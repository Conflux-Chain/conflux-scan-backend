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

        const total = await NFTMintStat.count({where: {statTime: {[Op.gte]: checkpoint}, statType: '1h'}});
        if (!total) return;
        let skip = 0;
        let pageSize = 10;
        let curPage = 1;

        do {
            const statArray = await NFTMintStat.findAll({
                where: {statTime: {[Op.gte]: checkpoint}, statType: '1h'},
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
                where: {bizId: statId, statType: '1h', statTime: searchTime},
                raw: true,
            });
        }

        if (statEpoch !== undefined) {
            stat = await NFTMintStat.findOne({
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
            bizValue0: BigInt(stat.nftAsset),
            lowerBoundInclude: stat.statTime,
            upperBoundExclude: statEndTime,
            minEpochNumber: stat.minEpoch,
            maxEpochNumber: stat.maxEpoch
        });
    }

    public async collect() {
        const trigger = this.bizStatInfo.trigger();
        if (!trigger) return;

        const latestEpoch = await Epoch.findOne({order: [['epoch', 'desc']], limit: 1})
        const statEnd = latestEpoch.timestamp;
        for (const i of lodash.range(this.statLatestDays)) {
            const statDays = this.statLatestDays - i;
            const {rangeBegin, rangeEnd} = this.getStatRange({statEnd, statDays});
            const total = await NFTMintStat.count({
                where: {[Op.and]: [{statTime: {[Op.gte]: rangeBegin}}, {statTime: {[Op.lt]: rangeEnd}}, {statType: '1h'}]}
            });
            if (!total) continue;

            let skip = 0;
            let pageSize = 10;
            let curPage = 1;
            do {
                const statArray = await NFTMintStat.findAll({
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
        await this.clear({model: NFTMintStat, statEnd, statDays: this.statLatestDays});
    }

    private async doStat({bizId, statEnd, statDays}) {
        const statType = `${statDays}d`;
        const statBegin = new Date(statEnd);
        statBegin.setDate(statEnd.getDate() - statDays);
        const stat = await NFTMintStat.findOne({where: {bizId, statType, statTime: statBegin}, raw: true});
        if (stat !== null) return;

        const sql = `select sum(nftAsset) as statNFTAsset,
                            min(minEpoch) as statMinEpoch,
                            max(maxEpoch) as statMaxEpoch
                     from ${NFTMintStat.getTableName()}
                     where bizId = ?
                       and statTime >= ?
                       and statTime < ?
                       and statType = '1h'`;
        const statNDaysInfo = await NFTMintStat.sequelize.query(sql,
            {type: QueryTypes.SELECT, replacements: [bizId, statBegin, statEnd]}
        ).then(arr => {
            const item = arr[0];
            return {
                bizId,
                statType,
                statTime: statBegin,
                nftAsset: item['statNFTAsset'] || 0,
                minEpoch: item['statMinEpoch'] || -1,
                maxEpoch: item['statMaxEpoch'] || -1,
            };
        });

        await NFTMintStat.sequelize.transaction(async (dbTx) => {
            if (statDays === this.statLatestDays) {
                await NFTMintStat.destroy({
                    where: {bizId, statType: '1h', statTime: {[Op.lt]: statBegin}}, transaction: dbTx
                });
            }
            await NFTMintStat.destroy({where: {bizId, statType}, transaction: dbTx});
            await NFTMintStat.create(statNDaysInfo, {transaction: dbTx});
        });
    }

    public async cache() {
        const queryOptions: any = {
            attributes: ['bizId', 'nftAsset', 'minEpoch', 'maxEpoch'],
            order: [['nftAsset', 'DESC']],
            offset: 0,
            limit: 10,
            raw: true,
            // logging: msg => console.log(`listMinerStat: ${msg}`),
        };

        const statTypeArray = ['1d', '3d', '7d'];
        for(const statType of statTypeArray){
            queryOptions.where = {statType};
            let list = await NFTMintStat.findAll(queryOptions);

            const {maxTime} = await this.getStatSpan(list);

            list = await this.convertToAddress(list);
            list.forEach(item => {
                delete item['minEpoch'];
                delete item['maxEpoch'];
            });

            this.cacheStatInfo[statType] = {maxTime, list};
        }
    }
}