import {StatHandler} from "../StatHandler";
import {BizStatInfo} from "../BizStatInfo";
import {STREAM_STAT_ADDR_TRANSACTION_Q} from "../../RedisWrap";
import {Op, QueryTypes} from "sequelize";
import {StatBucket} from "../StatBucket";
import {AddrTransactionStat} from "../../../model/AddrTransactionStat";
import {Epoch} from "../../../model/Epoch";
import {CONST} from "../../common/constant"

const lodash = require('lodash');

export class AddrTransactionHandler extends StatHandler {
    protected app: any;
    protected statLatestDays: number;

    public constructor(app: any) {
        super(app);
        this.app = app;
        this.statLatestDays = 7;
        this.bizQueue = STREAM_STAT_ADDR_TRANSACTION_Q;
        this.bizStatInfo = new BizStatInfo();
    }

    public bizAlias(): string {
        return `${AddrTransactionStat.getTableName()}`;
    }

    public async warmUp({reservedBuckets}) {
        const checkpoint = new Date();
        checkpoint.setMinutes(0, 0, 0);
        checkpoint.setHours(checkpoint.getHours() - reservedBuckets);

        const total = await AddrTransactionStat.count({where: {statType: '1h', statTime: {[Op.gte]: checkpoint}}});
        if (!total) return;
        let skip = 0;
        let pageSize = 10;
        let curPage = 1;

        do {
            const statArray = await AddrTransactionStat.findAll({
                where: {statType: '1h', statTime: {[Op.gte]: checkpoint}},
                offset: skip, limit: pageSize, raw: true,
            });
            if (statArray === null) return;

            for (const stat of statArray) {
                const statEndTime = new Date(stat.statTime);
                statEndTime.setMinutes(0, 0, 0);
                statEndTime.setHours(statEndTime.getHours() + 1);
                const bucket = new StatBucket({
                    bizValue0: BigInt(stat.sendCntr),
                    bizValue1: BigInt(stat.recvCntr),
                    bizValue2: BigInt(stat.gasSum),
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
                sendCntr: oldest.bizValue0,
                recvCntr: oldest.bizValue1,
                gasSum: oldest.bizValue2,
                minEpoch: oldest.minEpochNumber,
                maxEpoch: oldest.maxEpochNumber,
            };

            await AddrTransactionStat.upsert(record as AddrTransactionStat);
            bucketArray.shift();
        } while (bucketArray.length > reservedBuckets);
    }

    public async loadBucket({statId, statTime, statEpoch}) {
        let stat = null;
        if (statTime !== undefined) {
            const searchTime = new Date(statTime);
            searchTime.setMinutes(0, 0, 0);
            stat = await AddrTransactionStat.findOne({
                where: {statType: '1h', bizId: statId, statTime: searchTime},
                raw: true,
            });
        }

        if (statEpoch !== undefined) {
            stat = await AddrTransactionStat.findOne({
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
            bizValue0: BigInt(stat.sendCntr),
            bizValue1: BigInt(stat.recvCntr),
            bizValue2: BigInt(stat.gasSum),
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
            const total = await AddrTransactionStat.count({
                where: {statType: '1h', [Op.and]: [{statTime: {[Op.gte]: rangeBegin}}, {statTime: {[Op.lt]: rangeEnd}}]}
            });
            if (!total) continue;

            let skip = 0;
            let pageSize = 10;
            let curPage = 1;
            do {
                const statArray = await AddrTransactionStat.findAll({
                    where: {statType: '1h', [Op.and]: [{statTime: {[Op.gte]: rangeBegin}}, {statTime: {[Op.lt]: rangeEnd}}]},
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
        await this.clear({model: AddrTransactionStat, statEnd, statDays: this.statLatestDays});
    }

    private async doStat({bizId, statEnd, statDays}) {
        const statType = `${statDays}d`;
        const statBegin = new Date(statEnd);
        statBegin.setDate(statEnd.getDate() - statDays);
        const stat = await AddrTransactionStat.findOne({where: {statType, bizId, statTime: statBegin}, raw: true});
        if (stat !== null) return;

        const sql = `select sum(sendCntr) as statSendCntr,
                            sum(recvCntr) as statRecvCntr,
                            sum(gasSum) as statGasSum,
                            min(minEpoch) as statMinEpoch,
                            max(maxEpoch) as statMaxEpoch
                     from ${AddrTransactionStat.getTableName()}
                     where statType = '1h'
                       and bizId = ?
                       and statTime >= ?
                       and statTime < ?`;
        const statNDaysInfo = await AddrTransactionStat.sequelize.query(sql,
            {type: QueryTypes.SELECT, replacements: [bizId, statBegin, statEnd]}
        ).then(arr => {
            const item = arr[0];
            return {
                bizId,
                statType,
                statTime: statBegin,
                sendCntr: item['statSendCntr'] || 0,
                recvCntr: item['statRecvCntr'] || 0,
                gasSum: item['statGasSum'] || 0,
                minEpoch: item['statMinEpoch'] || -1,
                maxEpoch: item['statMaxEpoch'] || -1,
            };
        });

        await AddrTransactionStat.sequelize.transaction(async (dbTx) => {
            if (statDays === this.statLatestDays) {
                await AddrTransactionStat.destroy({
                    where: {statType: '1h', bizId, statTime: {[Op.lt]: statBegin}}, transaction: dbTx
                });
            }
            await AddrTransactionStat.destroy({where: {statType, bizId}, transaction: dbTx});
            await AddrTransactionStat.create(statNDaysInfo, {transaction: dbTx});
        });
    }

    public async cache() {
        const queryOptions: any = {
            offset: 0,
            limit: 10,
            raw: true,
            // logging: msg => console.log(`listAddrTransactionStat: ${msg}`),
        };

        const statTypeArray = ['1d', '3d', '7d'];
        const txTypeArray = [CONST.TX_TYPE.IN, CONST.TX_TYPE.OUT];
        for(const statType of statTypeArray){
            queryOptions.where = {statType};
            queryOptions.attributes = ['bizId', ['gasSum', 'gas'], 'minEpoch', 'maxEpoch'];
            queryOptions.order = [['gasSum', 'DESC']];
            let list = await AddrTransactionStat.findAll(queryOptions);

            const {maxTime} = await this.getStatSpan(list);
            const gasTotal = list?.length ? list.map(row=>BigInt(row['gas'])).reduce((a,b)=>a+b) : 0;

            list = await this.convertToAddress(list);
            list.forEach(item => {
                delete item['minEpoch'];
                delete item['maxEpoch'];
            });

            this.cacheStatInfo[statType] = {maxTime, gasTotal: gasTotal || 0, list};

            for(const txType of txTypeArray){
                const orderBy = txType === CONST.TX_TYPE.OUT ? 'sendCntr' : 'recvCntr';
                queryOptions.attributes = ['bizId', [orderBy, 'value'], 'minEpoch', 'maxEpoch'];
                queryOptions.order = [[orderBy, 'DESC']];
                let list = await AddrTransactionStat.findAll(queryOptions);

                const {minEpochNumber, maxEpochNumber, maxTime} = await this.getStatSpan(list);
                const valueTotal = await AddrTransactionStat.sum(orderBy, {
                    where: {statType, minEpoch: {[Op.gte]: minEpochNumber}, maxEpoch: {[Op.lte]: maxEpochNumber}},
                    // logging: msg => console.log(`listAddrTransactionStat.valueTotal: ${msg}`),
                });

                list = await this.convertToAddress(list);
                list.forEach(item => {
                    delete item['minEpoch'];
                    delete item['maxEpoch'];
                });

                const statInfoKey = `${statType}-${txType}`;
                this.cacheStatInfo[statInfoKey] = {maxTime, valueTotal: valueTotal || 0, list};
            }
        }
    }
}