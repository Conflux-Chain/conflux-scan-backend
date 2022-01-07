import {StatApp} from "../../../StatApp";
import {StatHandler} from "../StatHandler";
import {col, fn, Op} from "sequelize";
import {BizStatInfo} from "../BizStatInfo";
import {STREAM_STAT_DAILY_CFX_TRANSFER_Q} from "../../RedisWrap";
import {StatBucket} from "../StatBucket";
import {Epoch} from "../../../model/Epoch";
import {DailyCfxTransferStat} from "../../../model/DailyCfxTransferStat";

export class DailyCfxTransferHandler extends StatHandler {
    protected app: StatApp;
    protected statLatestDays: number;

    public constructor(app: StatApp) {
        super(app);
        this.app = app;
        this.statLatestDays = 1;
        this.bizQueue = STREAM_STAT_DAILY_CFX_TRANSFER_Q;
        this.bizStatInfo = new BizStatInfo();
    }

    public bizAlias(): string {
        return "daily_cfx_transfer";
    }

    public async warmUp({reservedBuckets}) {
        const checkpoint = new Date();
        checkpoint.setMinutes(0, 0, 0);
        checkpoint.setHours(checkpoint.getHours() - reservedBuckets);

        const statArray = await DailyCfxTransferStat.findAll({
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

            await DailyCfxTransferStat.upsert(record as DailyCfxTransferStat);
            bucketArray.shift();
        } while (bucketArray.length > reservedBuckets);
    }

    protected async loadBucket({statTime, statEpoch}) {
        let stat = null;
        if(statTime !== undefined){
            const searchTime = new Date(statTime);
            searchTime.setMinutes(0, 0, 0);
            stat = await DailyCfxTransferStat.findOne({
                where: {statType: '1h', statTime: searchTime},
                raw: true,
                // logging: msg => console.log(`transferStat: ${msg}`),
            });
        }

        if(statEpoch !== undefined){
            stat = await DailyCfxTransferStat.findOne({
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

    public async collectBucket() {
        const trigger = this.bizStatInfo.trigger();
        if(!trigger) return;

        const latestEpoch = await Epoch.findOne({order:[['epoch','desc']], limit: 1})
        const refer = latestEpoch.timestamp;
        const rangeEnd = new Date(refer);
        rangeEnd.setHours(0,0,0,0)
        const rangeStart = new Date(rangeEnd);
        rangeStart.setDate(rangeEnd.getDate() - 1);

        const stat = await DailyCfxTransferStat.findOne({where: {statType: '1d', statTime: rangeStart}, raw: true});
        if (stat !== null) return;

        const item = await DailyCfxTransferStat.findOne({
            attributes: [
                [fn('sum', col('transferCntr')), 'transferDaily'],
                [fn('min', col('minEpoch')), 'statMinEpoch'],
                [fn('max', col('maxEpoch')), 'statMaxEpoch'],
            ],
            where: {statType: '1h', [Op.and]: [{statTime: {[Op.gte]: rangeStart}}, {statTime: {[Op.lt]: rangeEnd}}]},
        });
        const statDaily =  {
                statType: '1d',
                statTime: rangeStart,
                transferCntr: item['transferDaily'],
                minEpoch: item['statMinEpoch'],
                maxEpoch: item['statMaxEpoch'],
        };
        await DailyCfxTransferStat.create(statDaily);
    }
}