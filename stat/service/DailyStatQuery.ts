import {Op} from "sequelize";
import {calCount, INTERVAL_TYPE} from "./common/utils";
import {DailyPosRewardStat, DailyPowRewardStat} from "../model/DailyReward";
import {DailyBurntFeeStat} from "../model/DailyBurntFeeStat";
import {DailyNFTHolder, DailyNFTStat} from "../model/DailyNFTStat";
import {VoteParams} from "../model/Epoch";
import {CONST as SDK_CONST} from "js-conflux-sdk";
import {u} from "@web3identity/address-encoder/lib/groestl-hash-js/op";

const lodash = require('lodash')
const BigFixed = require('bigfixed');

export class DailyStatQuery {
    public INTERVAL_TYPE = {hour: 'hour', day: 'day', month: 'month'};
    protected app;

    constructor(backendApp: any) {
        this.app = backendApp;
    }

    public async listNFTAssetStat({intervalType = 'day', skip, limit, sort, minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyNFTStat, ['statTime', ['nftAsset', 'count'], ['nftAssetTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit);
    }

    public async listNFTContractStat({intervalType = 'day', skip, limit, sort, minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyNFTStat, ['statTime', ['nftContract', 'count'], ['nftContractTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit);
    }

    public async listNFTTransferStat({intervalType = 'day', skip , limit , sort, minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyNFTStat, ['statTime', ['nftTransfer', 'count'], ['nftTransferTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit);
    }

    public async listNFTHolderStat({intervalType = 'day', skip , limit , sort, minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyNFTHolder, ['statTime', ['holderCount', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit);
    }

    public async listPowRewardStat({intervalType = 'day', skip, limit, sort, minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyPowRewardStat, ['statTime', ['powReward', 'count'], ['powRewardTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit);
    }

    public async listPosRewardStat({intervalType = 'day', skip, limit, sort, minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyPosRewardStat, ['statTime', ['posReward', 'count'], ['posRewardTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit);
    }

    public async listBurntFeeStat({intervalType = 'day', skip, limit, sort, minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyBurntFeeStat, ['statTime', 'burntStorageFee', 'burntGasFee', 'burntStorageFeeTotal', 'burntGasFeeTotal'],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit);
    }

    private async listStatByAttributeArray(model, attributeArray: any[], intervalType: string, minTimestamp: number,
                                           maxTimestamp: number, sort: string, skip: number, limit: number) {
        let statType;
        switch (intervalType) {
            case this.INTERVAL_TYPE.month:
                statType = '1m';
                break;
            case this.INTERVAL_TYPE.day:
                statType = '1d';
                break;
            case this.INTERVAL_TYPE.hour:
                statType = '1h';
                break;
            default:
                throw new Error(`intervalType:${intervalType} not supported`);
        }

        const queryOptions: any = {
            attributes: attributeArray,
            offset: skip,
            limit,
            order: [['statTime', sort]],
            raw: true
        };

        const conditionArray = [];
        conditionArray.push({statType});
        if (minTimestamp !== undefined) {
            conditionArray.push({statTime: {[Op.gte]: new Date(minTimestamp * 1000)}});
        }
        if (maxTimestamp !== undefined) {
            conditionArray.push({statTime: {[Op.lte]: new Date(maxTimestamp * 1000)}});
        }
        if (conditionArray.length === 1) {
            queryOptions.where = conditionArray[0];
        }
        if (conditionArray.length > 1) {
            queryOptions.where = {[Op.and]: conditionArray};
        }

        let count;
        let rows;
        if(intervalType === INTERVAL_TYPE.month) {
            const page = await model.findAndCountAll(queryOptions);
            count = page.count;
            rows = page.rows;
        } else{
            count = calCount(minTimestamp, maxTimestamp, intervalType);
            rows = await model.findAll(queryOptions);
        }

        rows.forEach(row => {
            // @ts-ignore
            row['statTime'] = row['statTime'].toISOString().replace('T', ' ').substr(0, 19);
            if(intervalType === INTERVAL_TYPE.month) {
                row['statTime'] = row['statTime'].substr(0,7);
            }
        });
        return {total: count, list: rows, intervalType};
    }

    public async listBurntRateStat({skip, limit, sort, minEpochNumber, maxEpochNumber}) {
        const {
            app: {cfx},
        } = this

        const paramsArray: VoteParams[] = await VoteParams.findAll({order: [['epoch', 'asc']] })
        if(!paramsArray?.length) {
            return {total: 0, list: []}
        }

        const epochFirst = paramsArray[0]['epoch']
        const epochFinalized = await cfx.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_FINALIZED)
        const epochStart = Math.max(epochFirst, minEpochNumber || 0)
        const epochEnd = Math.min(epochFinalized, maxEpochNumber || Number.MAX_VALUE)
        const total = epochEnd - epochStart + 1
        const effectSkip = Math.min(skip, total)
        const effectRange = Math.min(limit, total - effectSkip)

        const list = []
        let lastParams: any = {}
        const paramsMap = lodash.keyBy(paramsArray, 'epoch')
        lodash.range(effectRange).forEach(i => {
            const epoch = sort === 'asc' ? epochStart + effectSkip + i : epochEnd - effectSkip - i
            const params = paramsMap[epoch]

            const burntRate = {epoch} as any
            const namesMapping = [{prop: 'storagePointProp', rate: 'storagePointRate'}, {prop: 'baseFeeShareProp', rate: 'baseFeeShareRate'}]
            namesMapping.forEach(names => {
                if(params && params[names.prop]  ) {
                    burntRate[names.rate] = BigFixed(params[names.prop]).div(BigFixed(params[names.prop]).add(BigFixed(10**18)))
                    lastParams = {}
                } else{
                    if(lastParams[names.prop] === undefined) {
                        const target = lodash.findLast(paramsArray, params => params.epoch < epoch && params[names.prop])
                        if (target) {
                            lastParams[names.prop] = target[names.prop]
                        }
                    }
                    if(lastParams[names.prop]) {
                        burntRate[names.rate] = BigFixed(lastParams[names.prop]).div(BigFixed(lastParams[names.prop]).add(BigFixed(10**18)))
                    }
                }
            })
            list.push(burntRate)
        })

        return {total, list}
    }
}
