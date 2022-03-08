import {StatHandler} from "../StatHandler";
import {TokenTransferStat} from "../../../model/TokenTransferStat";
import {Op, QueryTypes} from "sequelize";
import {Token} from "../../../model/Token";
import {BizStatInfo} from "../BizStatInfo";
import {STREAM_STAT_TOKEN_TRANSFER_Q} from "../../RedisWrap";
import {StatBucket} from "../StatBucket";
import {Epoch} from "../../../model/Epoch";

const lodash = require('lodash');
const CONST = require('../../common/constant');

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
        const trigger = this.bizStatInfo.trigger();
        if (!trigger) return;

        const latestEpoch = await Epoch.findOne({order: [['epoch', 'desc']], limit: 1})
        const statEnd = latestEpoch.timestamp;
        for (const i of lodash.range(this.statLatestDays)) {
            const statDays = this.statLatestDays - i;
            const {rangeBegin, rangeEnd} = this.getStatRange({statEnd, statDays});
            const total = await TokenTransferStat.count({
                where: {[Op.and]: [{statTime: {[Op.gte]: rangeBegin}}, {statTime: {[Op.lt]: rangeEnd}}, {statType: '1h'}]}
            });
            if (!total) continue;

            let skip = 0;
            let pageSize = 10;
            let curPage = 1;
            do {
                const statArray = await TokenTransferStat.findAll({
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
        await this.clear({model: TokenTransferStat, statEnd, statDays: this.statLatestDays});
    }

    private async doStat({bizId, statEnd, statDays}) {
        const statType = `${statDays}d`;
        const statBegin = new Date(statEnd);
        statBegin.setDate(statEnd.getDate() - statDays);
        const stat = await TokenTransferStat.findOne({where: {bizId, statType, statTime: statBegin}, raw: true});
        if (stat !== null) return;

        const sql = `select sum(transferCntr) as statTransferCntr,
                            min(minEpoch) as statMinEpoch,
                            max(maxEpoch) as statMaxEpoch
                     from ${TokenTransferStat.getTableName()}
                     where bizId = ?
                       and statTime >= ?
                       and statTime < ?
                       and statType = '1h'`;
        const statNDaysInfo = await TokenTransferStat.sequelize.query(sql,
            {type: QueryTypes.SELECT, replacements: [bizId, statBegin, statEnd]}
        ).then(arr => {
            const item = arr[0];
            return {
                bizId,
                statType,
                statTime: statBegin,
                transferCntr: item['statTransferCntr'] || 0,
                minEpoch: item['statMinEpoch'] || -1,
                maxEpoch: item['statMaxEpoch'] || -1,
            };
        });

        await TokenTransferStat.sequelize.transaction(async (dbTx) => {
            if (statDays === this.statLatestDays) {
                await TokenTransferStat.destroy({
                    where: {bizId, statType: '1h', statTime: {[Op.lt]: statBegin}}, transaction: dbTx
                });
            }
            await TokenTransferStat.destroy({where: {bizId, statType}, transaction: dbTx});
            await TokenTransferStat.create(statNDaysInfo, {transaction: dbTx});
        });
    }

    public async cache() {
        const {
            app: { service },
        } = this;

        const queryOptions: any = {
            attributes: ['bizId', ['transferCntr', 'value'], 'minEpoch', 'maxEpoch'],
            order: [['transferCntr', 'DESC']],
            offset: 0,
            limit: 10,
            raw: true,
            // logging: msg => console.log(`listTokenTransferStat: ${msg}`),
        };

        const statTypeArray = ['1d', '3d', '7d'];
        const txTypeArray = [CONST.TX_TYPE.OUT, CONST.TX_TYPE.IN, CONST.TX_TYPE.ALL];
        for(const statType of statTypeArray) {
            queryOptions.where = {statType};
            let list = await TokenTransferStat.findAll(queryOptions);

            const {maxTime} = await this.getStatSpan(list);

            list = await this.convertToAddress(list);
            list.forEach(item => {
                delete item['minEpoch'];
                delete item['maxEpoch'];
            });

            this.cacheStatInfo[statType] = {maxTime, list};

            for (const txType of txTypeArray) {
                const statDays = parseInt(statType[0]);
                let statTxType = 'participants';
                if (txType === CONST.TX_TYPE.OUT) statTxType = 'senders';
                if (txType === CONST.TX_TYPE.IN) statTxType = 'receivers';
                const rankInfo = await service.rankService.rankTokenUniqueAddr({day: statDays, which: statTxType});
                const maxTime = rankInfo.maxTimeStart;
                const rankList = rankInfo.list.map(item => ({address: item.base32address, value: item.valueN}));
                this.cacheStatInfo[`uniqueAddr-${statType}-${txType}`] = {maxTime, list: rankList};
            }
        }
    }
}
