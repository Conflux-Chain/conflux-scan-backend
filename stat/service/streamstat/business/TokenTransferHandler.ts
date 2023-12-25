import {StatHandler} from "../StatHandler";
import {TokenTransferStat} from "../../../model/TokenTransferStat";
import {Op, QueryTypes} from "sequelize";
import {Token} from "../../../model/Token";
import {BizStatInfo} from "../BizStatInfo";
import {STREAM_STAT_TOKEN_TRANSFER_Q} from "../../RedisWrap";
import {StatBucket} from "../StatBucket";
import {Epoch} from "../../../model/Epoch";
import {CONST} from "../../common/constant"

export class TokenTransferHandler extends StatHandler {
    protected app: any;
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
                where: {statType: '1h', bizId: token.hex40id, statTime: {[Op.gte]: checkpoint}},
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
                where: {statType: '1h', bizId: statId, statTime: searchTime},
                raw: true,
                // logging: msg => console.log(`transferStat: ${msg}`),
            });
        }

        if(statEpoch !== undefined){
            stat = await TokenTransferStat.findOne({
                where: {statType: '1h', bizId: statId, minEpoch: {[Op.lte]: statEpoch}, maxEpoch: {[Op.gte]: statEpoch}},
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

    public async collect() {}

    public async cache() {
        const {
            app: { service },
        } = this;

        const table = TokenTransferStat.getTableName()
        const sql = `
            select tmp.* from
            (
                select tmp1.bizId,
                       sum(transferCntr) as transferCntr,
                       min(minEpoch) as minEpoch,
                       max(maxEpoch) as maxEpoch 
                from (select distinct(bizId) as bizId from ${table} where statType = '1h' and statTime >= :beginTime and statTime < :endTime) tmp1
                left join ${table} tmp2 on tmp1.bizId = tmp2.bizId
                where tmp2.statType = '1h' and tmp2.statTime >= :beginTime and tmp2.statTime < :endTime
                group by tmp1.bizId
            ) tmp 
            order by tmp.transferCntr desc limit 10
        `;

        const statDaysArray = [1, 3, 7];
        const latestEpoch = await Epoch.findOne({order: [['epoch', 'desc']], limit: 1})
        const endTime = latestEpoch.timestamp;
        for (const statDays of statDaysArray) {
            const beginTime = new Date(endTime);
            beginTime.setDate(endTime.getDate() - statDays);
            let list = await TokenTransferStat.sequelize.query(sql, {type: QueryTypes.SELECT, replacements: {beginTime, endTime}});

            const {maxTime} = await this.getStatSpan(list);
            list = await this.convertToAddress(list)

            list.forEach(item => {
                delete item['minEpoch'];
                delete item['maxEpoch'];
            });
            this.cacheStatInfo[`${statDays}d`] = {maxTime, list}

            const txTypeArray = [CONST.TX_TYPE.OUT, CONST.TX_TYPE.IN, CONST.TX_TYPE.ALL];
            for (const txType of txTypeArray) {
                let statTxType = 'participants';
                if (txType === CONST.TX_TYPE.OUT) statTxType = 'senders';
                if (txType === CONST.TX_TYPE.IN) statTxType = 'receivers';
                const rankInfo = await service.rankService.rankTokenUniqueAddr({day: statDays, which: statTxType});
                const maxTime = rankInfo.maxTimeStart;
                const rankList = rankInfo.list.map(item => ({address: item.base32address, value: item.valueN}));
                this.cacheStatInfo[`uniqueAddr-${statDays}d-${txType}`] = {maxTime, list: rankList};
            }
        }
    }
}
