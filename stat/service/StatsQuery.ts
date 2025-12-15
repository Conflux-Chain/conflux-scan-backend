import {Op, QueryTypes} from "sequelize";
import {calCount, INTERVAL_TYPE, ONE_MIN_IN_SECONDS, STAT_TYPE_CONVERTER} from "./common/utils";
import {DailyPosRewardStat, DailyPowRewardStat} from "../model/DailyReward";
import {DailyBurntFeeStat} from "../model/DailyBurntFeeStat";
import {DailyNFTHolder, DailyNFTStat} from "../model/DailyNFTStat";
import {getEpochRange, VoteParams} from "../model/Epoch";
import {StatApp} from "../StatApp";
import {CONST} from "./common/constant";
import {KEY_EPOCH_CIP1559_ENABLED, KV} from "../model/KV";
import {DailyGasStat} from "../model/DailyGasStat";
import {DailyContractCreate, DailyContractStat} from "../model/DailyContractStat";
import {FullBlock, FullBlockExt, FullTransaction, loadMaxBlockEpoch, loadMinBlockEpoch} from "../model/FullBlock";
import {Hex40Map} from "../model/HexMap";
import {format} from "js-conflux-sdk";
import {DailyTransaction} from "../model/DailyTransaction";
import {DailyCfxTxn} from "../model/CfxTransfer";
import {DailyTokenTxn} from "../model/Erc20Transfer";
import {DailyToken, Token} from "../model/Token";
import {Errors} from "./common/LogicError";
import {DailyCfxHolder} from "../model/DailyCfxHolder";
import {AddressStat, DailyActiveAddress} from "../model/StatAddress";
import {DailyBlockDataStat} from "../model/DailyBlockDataStat";
import {fmtDtUTC} from "../model/Utils";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class StatsQuery {
    private cfx;
    private firstBlockTimestamp: number;

    constructor({cfx}: any) {
        this.cfx = cfx;
        FullBlock.findOne({order: [['epoch', 'asc']]}).then((block: any) => {
            this.firstBlockTimestamp = Math.floor(block.createdAt.getTime() / 1000);
        });
    }

    /************open api***********/

    async listNFTAssetStats({intervalType, skip, limit, sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyNFTStat,
            attributes: ['statTime', ['nftAsset', 'count'], ['nftAssetTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listNFTContractStats({intervalType, skip, limit, sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyNFTStat,
            attributes: ['statTime', ['nftContract', 'count'], ['nftContractTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listNFTTransferStats({intervalType, skip , limit , sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyNFTStat,
            attributes: ['statTime', ['nftTransfer', 'count'], ['nftTransferTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listNFTHolderStats({intervalType, skip , limit , sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyNFTHolder,
            attributes: ['statTime', ['holderCount', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listPowRewardStats({intervalType, skip, limit, sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyPowRewardStat,
            attributes: ['statTime', ['powReward', 'count'], ['powRewardTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listPosRewardStats({intervalType, skip, limit, sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyPosRewardStat,
            attributes: ['statTime', ['posReward', 'count'], ['posRewardTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listGasStats({skip, limit, sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyGasStat,
            attributes: ['statTime', 'gasUsedSum', 'gasLimitAvg', 'gasPriceAvg', 'gasPriceMin', 'gasPriceMax', 'networkUtilization'],
            intervalType: INTERVAL_TYPE.day, minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listContractCreationStats({skip, limit, sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyContractCreate,
            attributes: [['statDay', 'statTime'], ['contractCount', 'count'], ['contractTotal', 'total']],
            intervalType: INTERVAL_TYPE.day, sortFiled: 'statDay', minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listDailyTransactionStats({attributes, skip, limit, sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyTransaction,
            attributes,
            intervalType: INTERVAL_TYPE.day, sortFiled: 'statDay', minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listDailyCfxTransferStats({skip, limit, sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyCfxTxn,
            attributes: [['day', 'statTime'], ['txnCount', 'transferCount'], 'userCount', 'amount'],
            sortFiled: 'day', minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listDailyTokenAnalysis({skip, limit, sort, minTimestamp, maxTimestamp, contract}) {
        const token = await Token.findOne({
            attributes: ['hex40id'],
            where: {base32: format.address(contract, StatApp.networkId)},
        });
        if (!token) {
            throw new Errors.ParameterError(`Token ${contract} not found.`)
        }

        return this.listStats({
            model: DailyToken,
            attributes: [
                ['day', 'statTime'],
                ['uniqueSender', 'uniqueSenderCount'],
                ['uniqueReceiver', 'uniqueReceiverCount'],
                ['participants', 'uniqueParticipantCount'],
                'transferCount',
                'holderCount',
            ],
            conditions: [{hexId: token.hex40id}],
            sortFiled: 'day',
            minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listDailyTokenTransferStats({skip, limit, sort, minTimestamp, maxTimestamp}) {
         return this.listStats({
            model: DailyTokenTxn,
            attributes: [
                ['day', 'statTime'],
                ['txnCount', 'transferCount'],
                ['userCount', 'userCount'],
            ],
            sortFiled: 'day',
            minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listCfxHolderStats({skip, limit, sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyCfxHolder,
            attributes: [['statDay', 'statTime'], ['holderCount', 'count']],
            intervalType: INTERVAL_TYPE.day, sortFiled: 'statDay',
            minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listAccountGrowthStats({skip, limit, sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: AddressStat,
            attributes: [['day', 'statTime'], ['cnt', 'count']],
            sortFiled: 'day',
            minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listAccountActiveStats({skip, limit, sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyActiveAddress,
            attributes: [['day', 'statTime'], ['cnt', 'count']],
            sortFiled: 'day',
            minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listBlockDataStats({intervalType, attributes, skip, limit, sort, minTimestamp, maxTimestamp}) {
        return this.listStats({
            model: DailyBlockDataStat,
            attributes, intervalType, minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listBurntFeeStats({skip, limit, sort, minTimestamp, maxTimestamp}) {
        const firstStat = await DailyBurntFeeStat.findOne({
            where: {statType: STAT_TYPE_CONVERTER[INTERVAL_TYPE.day]},
            order: [['statTime', 'asc']],
            limit: 1,
            raw: true,
        });

        if(minTimestamp === undefined || minTimestamp <= (firstStat.statTime.getTime() / 1000)) {
            minTimestamp = firstStat.statTime.getTime() / 1000;
        }

        return this.listStats({
            model: DailyBurntFeeStat,
            attributes: ['statTime', 'burntStorageFee', 'burntGasFee', 'burntStorageFeeTotal', 'burntGasFeeTotal'],
            intervalType: INTERVAL_TYPE.day, minTimestamp, maxTimestamp, sort, skip, limit
        });
    }

    async listBurntRateStats({skip, limit, sort, minTimestamp, maxTimestamp}) {
        if(!CONST.NETWORKS_CIP1559_ENABLED.includes(StatApp.networkId)) {
            return {total: 0, list: []}
        }

        if(!StatApp.epochCIP1559Enabled) {
            StatApp.epochCIP1559Enabled = await KV.getNumber(KEY_EPOCH_CIP1559_ENABLED, CONST.CHAIN_INFO[StatApp.networkId]?.EPOCH_CIP1559)
        }

        const fieldMapper = (stat: any) => {
            if(StatApp.isEVM) {
                stat['blockNumber'] = stat['epoch'];
            } else {
                stat['epochNumber'] = stat['epoch'];
            }
            stat['storageBurntRate'] = BigFixed(stat.storagePointProp).div(BigFixed(stat.storagePointProp).add(BigFixed(10**18)));
            if(stat.epoch >= StatApp.epochCIP1559Enabled) {
                stat['baseFeeBurntRate'] = BigFixed(1).sub(BigFixed(stat.baseFeeShareProp).div(BigFixed(stat.baseFeeShareProp).add(BigFixed(10**18))));
            } else{
                stat['baseFeeBurntRate'] = BigFixed(0);
            }
            stat['timestamp'] = stat.timestamp.getTime() / 1000;

            delete stat.epoch;
            delete stat.storagePointProp;
            delete stat.baseFeeShareProp;
        }

        return this.listStats({
            model: VoteParams,
            sortFiled: 'timestamp', minTimestamp, maxTimestamp, sort, skip, limit, fieldMapper});
    }

    private async listStats({
        model,
        attributes,
        conditions = [],
        intervalType,
        minTimestamp,
        maxTimestamp,
        sort,
        sortFiled = 'statTime',
        skip,
        limit,
        fieldMapper,
    }:{
        model: any,
        attributes?: any[],
        conditions?: any[],
        intervalType?: string,
        minTimestamp?: number,
        maxTimestamp?: number,
        sort: string,
        sortFiled?: string,
        skip: number,
        limit: number,
        fieldMapper?: any,
    }) {
        const conds: any[] = [...conditions];
        if(intervalType !== undefined) {
            const statType = STAT_TYPE_CONVERTER[intervalType];
            if(!statType) {
                throw new Error(`IntervalType:${intervalType} not supported`);
            }
            conds.push({statType});
        }
        if (minTimestamp !== undefined) {
            conds.push({[sortFiled]: {[Op.gte]: new Date(minTimestamp * 1000)}});
        }
        if (maxTimestamp !== undefined) {
            conds.push({[sortFiled]: {[Op.lte]: new Date(maxTimestamp * 1000)}});
        }

        const options: any = {
            attributes,
            offset: skip,
            limit,
            order: [[sortFiled, sort]],
            raw: true
        };
        if (conds.length === 1) {
            options.where = conds[0];
        }
        if (conds.length > 1) {
            options.where = {[Op.and]: conds};
        }

        let total;
        let list;
        if(intervalType === undefined || intervalType === INTERVAL_TYPE.month || intervalType === INTERVAL_TYPE.day) {
            const page = await model.findAndCountAll(options);
            total = page.count;
            list = page.rows;
        } else{
            total = calCount({
                minTimestampUTC: minTimestamp || this.firstBlockTimestamp,
                maxTimestampUTC: maxTimestamp,
                intervalType
            });
            list = await model.findAll(options);
        }

        const defaultMapper = (intervalType: string) => {
            if (!intervalType) return undefined;
            const formatters = {
                [INTERVAL_TYPE.min]: (time) => time.toISOString().replace('T', ' ').substr(0, 16),
                [INTERVAL_TYPE.hour]: (time) => time.toISOString().replace('T', ' ').substr(0, 13),
                [INTERVAL_TYPE.day]: (time) => time.toISOString().substr(0, 10),
                [INTERVAL_TYPE.month]: (time) => time.toISOString().substr(0, 7),
            };
            return (stat: any) => {
                stat.statTime = formatters[intervalType](stat.statTime);
            };
        };

        const mapper = fieldMapper || defaultMapper(intervalType);
        mapper && list.forEach(mapper);

        return {total, list, intervalType};
    }

    /********scan private api*******/

    async listDailyContractTransferStat({address, sort='asc', skip = 0, limit = 1000}) {
        const addressInfo = await Hex40Map.findOne({where: {hex: format.hexAddress(address).substr(2)}});
        const addressId = addressInfo?.id;
        if (addressId === undefined) {
            return {total: 0, list: []};
        }

        const truncateHour = (date: Date) => {
            const truncated = new Date(date);
            truncated.setHours(0, 0, 0, 0);
            return truncated;
        }
        const createDate = truncateHour(addressInfo.createdAt);
        const latestDate = truncateHour(new Date());
        latestDate.setDate(latestDate.getDate() - 1);

        const {isEmpty, totalDays: total, minDate, maxDate} = this.calDateRange(sort, skip, limit, createDate, latestDate);
        if (isEmpty) {
            return {total: 0, list: []};
        }

        const opt: any = {
            attributes: ['statTime', 'tx', 'cfxTransfer', 'tokenTransfer'],
            where: {
                hex40id: addressId,
                [Op.and]: [
                    {statTime: {[Op.gte]: minDate}},
                    {statTime: {[Op.lte]: maxDate}},
                ],
            },
            order: [['statTime', sort]],
            offset: 0,
            limit,
            raw: true,
        };

        const stats = await DailyContractStat.findAll(opt);

        const dateFormatter = (date: Date) => (date.toISOString().replace('T', ' ').substr(0, 10));
        stats.forEach((row: any) =>{
            row['statTime'] = dateFormatter(row['statTime']);
        });

        const list = this.fillZeroData({
            minDate,
            maxDate,
            statList: stats,
            sort,
            defaultStat: {
                tx: 0,
                cfxTransfer: 0,
                tokenTransfer: 0,
            },
            dateFormatter,
        });

        return {total, list};
    }

    async listLatestBlockDataStats({intervalType, limit = 1}) {
        if (intervalType === INTERVAL_TYPE.hour || intervalType === INTERVAL_TYPE.day) {
            const page = await this.listBlockDataStats({
                intervalType,
                attributes: ['blockTime', 'difficulty', 'hashRate', 'tps', 'statTime'],
                skip: 0,
                limit,
                sort: 'desc',
            } as any);

            const stats = page.list;
            stats.forEach((data: any) => {
                const localTime = new Date(data.statTime);
                data.timestamp = String((localTime.getTime() - localTime.getTimezoneOffset() * 600000) / 1000);
            });

            const list = lodash.orderBy(stats, 'timestamp', 'asc');

            return {total: list.length, list};
        }

        const maxBlock = await FullBlock.findOne({order: [['epoch', 'desc']]});
        maxBlock.createdAt.setSeconds(0);
        const beginTime = new Date(maxBlock.createdAt);
        beginTime.setMinutes(beginTime.getMinutes() - limit);

        const blockStats = await FullBlock.sequelize.query(`
            SELECT 
                COUNT(*) AS blockCount, 
                SUM( difficulty ) AS difficultySum, 
                DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:00') AS statTime
            FROM full_block 
            WHERE 
                createdAt >= ? 
            GROUP BY statTime 
            ORDER BY statTime ASC
            `, {
            type: QueryTypes.SELECT,
            replacements: [fmtDtUTC(beginTime)],
        });

        if (!blockStats?.length) {
            return {total: 0, list: []};
        }

        const txStats = await FullTransaction.sequelize.query(`
            SELECT 
                COUNT(*) AS txCount, 
                DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:00') AS statTime
            FROM full_tx 
            WHERE 
                createdAt >= ? 
            GROUP BY statTime 
            ORDER BY statTime ASC
            `, {
            type: QueryTypes.SELECT,
            replacements: [fmtDtUTC(beginTime)],
        });

        const txStatMap = {};
        txStats?.forEach(row => {
            txStatMap[(row['statTime'])] = row['txCount'];
        });

        const stats = [];
        const interval = ONE_MIN_IN_SECONDS;
        for (const blockStat of blockStats) {
            if (blockStat !== undefined) {
                const statTime = blockStat['statTime'];
                const blockCount = blockStat['blockCount'];
                const txCount = txStatMap[statTime] || 0;
                const difficultySum = blockStat['difficultySum'];
                const blockTime = BigFixed(interval).div(BigFixed(blockCount));
                const hashRate = BigFixed(difficultySum).div(BigFixed(interval));
                const difficulty = BigFixed(difficultySum).div(BigFixed(blockCount));
                const tps = BigFixed(txCount).div(BigFixed(interval));
                const date = new Date(statTime);
                stats.push({
                    statTime: date, blockTime, hashRate, difficulty, tps,
                    timestamp: String(date.getTime() / 1000),
                });
            }
        }

        let list = lodash.orderBy(stats, 'timestamp', 'asc');
        list = list.slice(0, Math.max(list.length - 1, 0));

        return {total: list.length, list};
    }

    async listCIP1559Stats({statType, skip, limit, sort, minTimestamp, maxTimestamp, minEpochNumber, maxEpochNumber}) {
        const pivot = statType === CIP1559StatType.BASE_FEE;

        const result = await this.listBlocks(
            minTimestamp,
            maxTimestamp,
            minEpochNumber,
            maxEpochNumber,
            sort,
            skip,
            limit,
            pivot
        );

        result.list = result.list.map(block => {
            const stat = StatApp.isEVM ?
                {blockNumber: block.epoch} :
                {epochNumber: block.epoch, blockIndex: block.position};
            lodash.assign(stat, {timestamp: block.createdAt.getTime() / 1000});

            switch (statType) {
                case CIP1559StatType.BASE_FEE:
                    lodash.assign(stat, {baseFee: block?.extra?.baseFee || 0});
                    break;
                case CIP1559StatType.PRIORITY_FEE:
                    lodash.assign(stat, {avgPriorityFee: block?.extra?.avgTip || 0});
                    break;
                case CIP1559StatType.GAS_USED:
                    lodash.assign(stat, {gasUsed: block?.gasUsed || 0});
                    break;
                case CIP1559StatType.TXS_BY_TYPE:
                    let txsInType = {legacy: 0, cip2930: 0, cip1559: 0};
                    if(block?.extra?.txsInType) {
                        const typedTxsArr = block?.extra?.txsInType;
                        txsInType = {legacy: typedTxsArr[0], cip2930: typedTxsArr[1], cip1559: typedTxsArr[2]};
                    }
                    lodash.assign(stat, {txsInType});
                    break;
                default:
                    throw new Error(`The stat type ${statType} not supported!`);
            }

            return stat;
        })

        return result;
    }

    private fillZeroData({
         minDate,
         maxDate,
         statList,
         sort,
         sortFiled = 'statTime',
         defaultStat,
         dateFormatter,
     }) {
        const statMap = lodash.keyBy(statList, sortFiled);

        const list = [];
        while (minDate < maxDate) {
            const statDay = dateFormatter(minDate);

            list.push(statMap[statDay] || {
                [sortFiled]: statDay,
                ...defaultStat,
            });

            minDate.setDate(minDate.getDate() + 1);
        }

        return lodash.orderBy(list, sortFiled, sort);
    }

    private calDateRange(
        sort: string = 'asc',
        skip: number = 0,
        limit: number = 365,
        createDate: Date,
        latestDate: Date = new Date(),
    ) {
        const isAsc = sort.toLowerCase() === 'asc';
        const baseDate = new Date(isAsc ? createDate : latestDate);
        const direction = isAsc ? 1 : -1;

        const totalDays = calCount({
            minTimestampUTC: createDate.getTime()/1000,
            maxTimestampUTC: latestDate.getTime()/1000,
            intervalType: INTERVAL_TYPE.day,
        });
        const effectiveSkip = Math.max(0, Math.min(skip, totalDays));
        const effectiveLimit = Math.max(0, Math.min(limit, totalDays - effectiveSkip));

        if (effectiveLimit === 0) {
            return {
                totalDays,
                isEmpty: true
            };
        }

        const addDays = (date: Date, days: number) => {
            const result = new Date(date);
            result.setDate(result.getDate() + days);
            return result;
        };

        return {
            totalDays,
            isEmpty: false,
            minDate: addDays(baseDate, direction * (effectiveSkip + (isAsc ? 0 : effectiveLimit))),
            maxDate: addDays(baseDate, direction * (effectiveSkip + (isAsc ? effectiveLimit : 0))),
        };
    }

    private async listBlocks(
        minTimestamp: number,
        maxTimestamp: number,
        minEpochNumber: number,
        maxEpochNumber: number,
        sort: string,
        skip: number,
        limit: number,
        pivot: boolean = undefined
    ) {
        const queryOptions: any = {
            attributes: ['epoch', 'position', 'createdAt', 'gasUsed'],
            offset: skip,
            limit,
            order: [['epoch', sort], ['position', sort]],
            raw: true,
            logging: console.log
        };

        const conditionArray = [];
        if (minTimestamp !== undefined) {
            conditionArray.push({createdAt: {[Op.gte]: new Date(minTimestamp * 1000)}});
        }
        if (maxTimestamp !== undefined) {
            conditionArray.push({createdAt: {[Op.lte]: new Date(maxTimestamp * 1000)}});
        }
        if(minEpochNumber !== undefined) {
            conditionArray.push({epoch: { [Op.gte]: minEpochNumber}});
        }
        if(maxEpochNumber !== undefined) {
            conditionArray.push({epoch: { [Op.lte]: maxEpochNumber}});
        }
        if(pivot) {
            conditionArray.push({pivot: true});
        }
        if (conditionArray.length === 1) {
            queryOptions.where = conditionArray[0];
        }
        if (conditionArray.length > 1) {
            queryOptions.where = {[Op.and]: conditionArray};
        }

        const epochRange = await getEpochRange(minTimestamp, maxTimestamp, minEpochNumber, maxEpochNumber);
        const [minBlkEpoch, maxBlkEpoch] = await Promise.all([loadMinBlockEpoch(), loadMaxBlockEpoch()]);
        const epochBegin = epochRange?.epochBegin ?? minBlkEpoch;
        const epochEnd = epochRange?.epochEnd ?? maxBlkEpoch;

        let total;
        if(pivot) {
            total = epochEnd - epochBegin + 1;
        } else{
            const [minBlk, maxBlk] = await Promise.all([
                this.cfx.getBlockByEpochNumber(epochBegin),
                this.cfx.getBlockByEpochNumber(epochEnd)
            ]);
            total = maxBlk.blockNumber - minBlk.blockNumber + 1;
        }

        const list  = await FullBlock.findAll(queryOptions) as any[];
        if(!list?.length) {
            return {total, list: []};
        }

        const [epochFirst, epochLast] = [list[0].epoch, list[list.length - 1].epoch];
        const [minEpoch, maxEpoch] = epochFirst <= epochLast ? [epochFirst, epochLast] : [epochLast, epochFirst];
        const blkExts = await FullBlockExt.findAll({
            where: {
                [Op.and]: [
                    {epoch: { [Op.gte]: minEpoch}},
                    {epoch: { [Op.lte]: maxEpoch}},
                ]
            }});
        const blkExtMap = lodash.keyBy(blkExts, blk => `${blk.epoch}-${blk.position}`);

        list.forEach(blk => {
            if(blkExtMap && blkExtMap[`${blk.epoch}-${blk.position}`]?.extra) {
                blk['extra'] = JSON.parse(blkExtMap[`${blk.epoch}-${blk.position}`]?.extra);
            }
        });

        return {total, list};
    }
}

export enum CIP1559StatType {
    BASE_FEE,
    PRIORITY_FEE,
    GAS_USED,
    TXS_BY_TYPE
}
