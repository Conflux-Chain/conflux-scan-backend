import {StatHandler} from "../StatHandler";
import {col, fn, Op} from "sequelize";
import {BizStatInfo} from "../BizStatInfo";
import {STREAM_STAT_DAILY_TOKEN_TRANSFER_Q} from "../../RedisWrap";
import {StatBucket} from "../StatBucket";
import {Epoch} from "../../../model/Epoch";
import {DailyTokenTransferStat} from "../../../model/DailyTokenTransferStat";

export class DailyTokenTransferHandler extends StatHandler {
    protected app: any;
    protected statLatestDays: number;

    public constructor(app: any) {
        super(app);
        this.app = app;
        this.statLatestDays = 1;
        this.bizQueue = STREAM_STAT_DAILY_TOKEN_TRANSFER_Q;
        this.bizStatInfo = new BizStatInfo();
    }

    public bizAlias(): string {
        return `${DailyTokenTransferStat.getTableName()}`;
    }

    public async warmUp({reservedBuckets}) {
        const checkpoint = new Date();
        checkpoint.setMinutes(0, 0, 0);
        checkpoint.setHours(checkpoint.getHours() - reservedBuckets);

        const statArray = await DailyTokenTransferStat.findAll({
            where: {statType: '1h', statTime: {[Op.gte]: checkpoint}},
            order: [['statTime', 'ASC']],
            raw: true,
        });
        if (statArray === null) return;

        this.bizStatInfo.statRecords[0] = statArray.forEach(stat => {
            const statEndTime = new Date(stat.statTime);
            statEndTime.setMinutes(0, 0, 0);
            statEndTime.setHours(statEndTime.getHours() + 1);
            return new StatBucket({
                bizValue0: BigInt(stat.transferCntr),
                lowerBoundInclude: stat.statTime,
                upperBoundExclude: statEndTime,
                minEpochNumber: stat.minEpoch,
                maxEpochNumber: stat.maxEpoch
            });
        });
    }

    public async rollupBucket({statId, bucketArray, reservedBuckets}) {
        do {
            const oldest = bucketArray[0];
            const record = {
                statType: '1h',
                statTime: oldest.lowerBoundInclude,
                transferCntr: oldest.bizValue0,
                minEpoch: oldest.minEpochNumber,
                maxEpoch: oldest.maxEpochNumber,
            };

            await DailyTokenTransferStat.upsert(record as DailyTokenTransferStat);
            bucketArray.shift();
        } while (bucketArray.length > reservedBuckets);
    }

    protected async loadBucket({statTime, statEpoch}) {
        let stat = null;
        if(statTime !== undefined){
            const searchTime = new Date(statTime);
            searchTime.setMinutes(0, 0, 0);
            stat = await DailyTokenTransferStat.findOne({
                where: {statType: '1h', statTime: searchTime},
                raw: true,
                // logging: msg => console.log(`transferStat: ${msg}`),
            });
        }

        if(statEpoch !== undefined){
            stat = await DailyTokenTransferStat.findOne({
                where: {statType: '1h', minEpoch: {[Op.lte]: statEpoch}, maxEpoch: {[Op.gte]: statEpoch}},
                raw: true,
                // logging: msg => console.log(`transferStat: ${msg}`),
            });
        }

        if(!stat){
            return stat;
        }

        const statEndTime = new Date(stat.statTime);
        statEndTime.setMinutes(0, 0, 0);
        statEndTime.setHours(statEndTime.getHours() + 1);
        return new StatBucket({
            bizValue0: BigInt(stat.transferCntr),
            lowerBoundInclude: stat.statTime,
            upperBoundExclude: statEndTime,
            minEpochNumber: stat.minEpoch,
            maxEpochNumber: stat.maxEpoch
        });
    }

    public async collect() {
        const trigger = this.bizStatInfo.trigger();
        if(!trigger) return;

        const latestEpoch = await Epoch.findOne({order:[['epoch','desc']], limit: 1})
        const refer = latestEpoch.timestamp;
        const rangeEnd = new Date(refer);
        rangeEnd.setHours(0,0,0,0)
        const rangeStart = new Date(rangeEnd);
        rangeStart.setDate(rangeEnd.getDate() - 1);

        const stat = await DailyTokenTransferStat.findOne({where: {statType: '1d', statTime: rangeStart}, raw: true});
        if (stat !== null) return;

        const item = await DailyTokenTransferStat.findOne({
            attributes: [
                [fn('sum', col('transferCntr')), 'transferDaily'],
                [fn('min', col('minEpoch')), 'statMinEpoch'],
                [fn('max', col('maxEpoch')), 'statMaxEpoch'],
            ],
            where: {statType: '1h', [Op.and]: [{statTime: {[Op.gte]: rangeStart}}, {statTime: {[Op.lt]: rangeEnd}}]},
            raw: true,
        });
        const statDaily =  {
                statType: '1d',
                statTime: rangeStart,
                transferCntr: item['transferDaily'],
                minEpoch: item['statMinEpoch'],
                maxEpoch: item['statMaxEpoch'],
        };
        await DailyTokenTransferStat.create(statDaily);
    }

    protected cache() {
    }
}