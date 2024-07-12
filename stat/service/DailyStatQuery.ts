import {Op} from "sequelize";
import {calCount, INTERVAL_TYPE} from "./common/utils";
import {DailyPosRewardStat, DailyPowRewardStat} from "../model/DailyReward";
import {DailyBurntFeeStat} from "../model/DailyBurntFeeStat";
import {DailyNFTHolder, DailyNFTStat} from "../model/DailyNFTStat";
import {Epoch, getEpochRange, VoteParams} from "../model/Epoch";
import {CONST as SDK_CONST} from "js-conflux-sdk";
import {IntervalType} from "./timerstat/TimerStat";
import {StatApp} from "../StatApp";

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

    public async listBurntFeeStat({skip, limit, sort, minTimestamp = undefined, maxTimestamp = undefined}) {
        const firstStat = await DailyBurntFeeStat.findOne({
            where: {statType: IntervalType.DAY}, order: [['statTime', 'asc']], limit: 1, raw: true})
        if(minTimestamp === undefined || minTimestamp <= (firstStat.statTime.getTime() / 1000)) {
            minTimestamp = firstStat.statTime.getTime() / 1000
        }
        return this.listStatByAttributeArray(DailyBurntFeeStat, ['statTime', 'burntStorageFee', 'burntGasFee', 'burntStorageFeeTotal', 'burntGasFeeTotal'],
            INTERVAL_TYPE.day, minTimestamp, maxTimestamp, sort, skip, limit);
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

    public async listBurntRateStat({skip, limit, sort, minTimestamp, maxTimestamp}) {
        const queryOptions: any = {
            order: [['epoch', sort]],
            offset: skip,
            limit: limit,
            raw: true,
        }
        const conditionArray = [];
        if (minTimestamp !== undefined) {
            conditionArray.push({timestamp: {[Op.gte]: new Date(minTimestamp * 1000)}});
        }
        if (maxTimestamp !== undefined) {
            conditionArray.push({timestamp: {[Op.lte]: new Date(maxTimestamp * 1000)}});
        }
        if (conditionArray.length === 1) {
            queryOptions.where = conditionArray[0];
        }
        if (conditionArray.length > 1) {
            queryOptions.where = {[Op.and]: conditionArray};
        }

        const page = await VoteParams.findAndCountAll(queryOptions)

        page.rows.forEach((param: any) => {
            if(StatApp.isEVM) {
                param['blockNumber'] = param['epoch']
            } else {
                param['epochNumber'] = param['epoch']
            }
            param['storagePointRate'] = BigFixed(param.storagePointProp).div(BigFixed(param.storagePointProp).add(BigFixed(10**18)))
            param['baseFeeShareRate'] = BigFixed(1).sub(BigFixed(param.baseFeeShareProp).div(BigFixed(param.baseFeeShareProp).add(BigFixed(10**18))))
            param['timestamp'] = param.timestamp.getTime() / 1000
            delete param.epoch
            delete param.storagePointProp
            delete param.baseFeeShareProp
        })

        return {total: page.count, list: page.rows}
    }
}
