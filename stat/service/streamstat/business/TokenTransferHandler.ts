import {StatApp} from "../../../StatApp";
import {StatHandler} from "../StatHandler";
import {TokenTransferStat} from "../../../model/TokenTransferStat";
import {col, fn, Op} from "sequelize";
import {Token} from "../../../model/Token";
import {BizStatInfo} from "../BizStatInfo";
import {STREAM_STAT_TOKEN_TRANSFER_Q} from "../../RedisWrap";
import {StatBucket} from "../StatBucket";
import {Epoch} from "../../../model/Epoch";
import {AddrCfxTransferStat} from "../../../model/AddrCfxTransferStat";

export class TokenTransferHandler extends StatHandler {
    protected app: StatApp;
    protected statLatestDays: number;

    public constructor(app: any) {
        super(app);
        this.app = app;
        this.statLatestDays = 7;
        this.bizQueue = STREAM_STAT_TOKEN_TRANSFER_Q;
        this.bizStatInfo = new BizStatInfo();
    }

    public bizAlias(): string {
        return `${TokenTransferStat.getTableName()}`;
    }

    public async warmUp({reservedBuckets}) {
        const checkpoint = new Date();
        checkpoint.setMinutes(0, 0, 0);
        checkpoint.setHours(checkpoint.getHours() - reservedBuckets);

        const tokens = await Token.findAll({
            attributes: ['id', 'hex40id'],
            where: {auditResult: true},
        });

        for (const token of tokens) {
            const statArray = await TokenTransferStat.findAll({
                where: {bizId: token.hex40id, statType: '1h', statTime: {[Op.gte]: checkpoint}},
                order: [['statTime', 'ASC']],
                raw: true,
                // logging: msg => console.log(`[type=${this.bizAlias()}]preload: ${msg}`),
            });
            if (statArray === null) continue;

            this.bizStatInfo.statRecords[token.hex40id] = statArray.forEach(stat => {
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
    }

    public async rollupBucket({statId, bucketArray, reservedBuckets}) {
        do {
            const oldest = bucketArray[0];
            const record = {
                bizId: statId,
                statType: '1h',
                statTime: oldest.lowerBoundInclude,
                transferCntr: oldest.bizValue0,
                minEpoch: oldest.minEpochNumber,
                maxEpoch: oldest.maxEpochNumber,
            };

            await TokenTransferStat.upsert(record as TokenTransferStat);
            bucketArray.shift();
        } while (bucketArray.length > reservedBuckets);
    }

    protected async loadBucket({statId, statTime, statEpoch}) {
        let stat = null;
        if(statTime !== undefined){
            const searchTime = new Date(statTime);
            searchTime.setMinutes(0, 0, 0);
            stat = await TokenTransferStat.findOne({
                where: {bizId: statId, statType: '1h', statTime: searchTime},
                raw: true,
                // logging: msg => console.log(`transferStat: ${msg}`),
            });
        }

        if(statEpoch !== undefined){
            stat = await TokenTransferStat.findOne({
                where: {bizId: statId, statType: '1h', minEpoch: {[Op.lte]: statEpoch}, maxEpoch: {[Op.gte]: statEpoch}},
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
        const trigger = await this.bizStatInfo.trigger();
        if(!trigger) return;

        const latestEpoch = await Epoch.findOne({order:[['epoch','desc']], limit: 1});
        const statEnd = latestEpoch.timestamp;
        const statStart = new Date(statEnd);
        statStart.setDate(statEnd.getDate() - this.statLatestDays);

        const tokens = await Token.findAll({
            attributes: ['id', 'hex40id'],
            where: {auditResult: true},
        });

        for (const token of tokens) {
            const statItem = await TokenTransferStat.findOne({
                attributes: [[fn('sum', col('transferCntr')), 'transferLatest']],
                where: {bizId: token.hex40id, statType: '1h', statTime: {[Op.gte]: statStart}}, raw: true,
                // logging: msg => console.log(`transferLatest: ${msg}`),
            });

            await Token.sequelize.transaction(async (dbTx) => {
                await Token.update({transferLatest: statItem['transferLatest'] || 0} , {
                    where: {id: token.id},
                    transaction: dbTx,
                });
                await TokenTransferStat.destroy({
                    where: {bizId: token.hex40id, statType: '1h', statTime: {[Op.lt]: statStart},},
                    transaction: dbTx,
                });
            });
        }
    }
}