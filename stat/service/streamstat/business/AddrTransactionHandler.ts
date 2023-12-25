import {StatHandler} from "../StatHandler";
import {BizStatInfo} from "../BizStatInfo";
import {STREAM_STAT_ADDR_TRANSACTION_Q} from "../../RedisWrap";
import {Op, QueryTypes, Sequelize} from "sequelize";
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
    }

    public async cache() {
        const table = AddrTransactionStat.getTableName()
        const sql = `
            select tmp.* from
            (
                select tmp1.bizId, 
                       sum(sendCntr) as sendCntr,
                       sum(recvCntr) as recvCntr,
                       sum(gasSum) as gasFee,
                       min(minEpoch) as minEpoch,
                       max(maxEpoch) as maxEpoch 
                from (select distinct(bizId) as bizId from ${table} where statType = '1h' and statTime >= :beginTime and statTime < :endTime) tmp1
                left join ${table} tmp2 on tmp1.bizId = tmp2.bizId
                where tmp2.statType = '1h' and tmp2.statTime >= :beginTime and tmp2.statTime < :endTime
                group by tmp1.bizId
            ) tmp 
            order by _order desc limit 10
        `;

        const statDaysArray = [1, 3, 7];
        const latestEpoch = await Epoch.findOne({order: [['epoch', 'desc']], limit: 1})
        const endTime = latestEpoch.timestamp;
        for (const statDays of statDaysArray) {
            const beginTime = new Date(endTime);
            beginTime.setDate(endTime.getDate() - statDays);
            const sendCntrTopN = await AddrTransactionStat.sequelize.query(sql.replace('_order', 'tmp.sendCntr'),
                    {type: QueryTypes.SELECT, replacements: {beginTime, endTime}})
            const recvCntrTopN = await AddrTransactionStat.sequelize.query(sql.replace('_order', 'tmp.recvCntr'),
                    {type: QueryTypes.SELECT, replacements: {beginTime, endTime}})
            const gasFeeTopN = await AddrTransactionStat.sequelize.query(sql.replace('_order', 'tmp.gasFee'),
                    {type: QueryTypes.SELECT, replacements: {beginTime, endTime}})

            const topN2D = [
                {list: sendCntrTopN, type: CONST.TX_TYPE.OUT},
                {list: recvCntrTopN, type: CONST.TX_TYPE.IN},
                {list: gasFeeTopN, type: 'gasFee'}
            ]
            for (const topN of topN2D) {
                let list = await this.convertToAddress(topN.list)
                const {maxTime} = await this.getStatSpan(topN.list)

                const statObjKey = topN.type === 'gasFee' ? `${statDays}d` : `${statDays}d-${topN.type}`
                const statObjVal = {
                    maxTime,
                }
                if(topN.type === CONST.TX_TYPE.OUT) {
                    list = list.map(item => {return {address: item.address, value: item['sendCntr']}})
                    statObjVal['valueTotal'] = list?.length ? list.map(row=>BigInt(row['value'])).reduce((a,b)=>a+b) : 0
                }
                if(topN.type === CONST.TX_TYPE.IN) {
                    list = list.map(item => {return {address: item.address, value: item['recvCntr']}})
                    statObjVal['valueTotal'] = list?.length ? list.map(row=>BigInt(row['value'])).reduce((a,b)=>a+b) : 0
                }
                if(topN.type === 'gasFee') {
                    list = list.map(item => {return {address: item.address, gas: item['gasFee']}})
                    statObjVal['gasTotal'] = list?.length ? list.map(row=>BigInt(row['gas'])).reduce((a,b)=>a+b) : 0
                }
                statObjVal['list'] = list
                this.cacheStatInfo[statObjKey] = statObjVal
            }
        }
    }
}
