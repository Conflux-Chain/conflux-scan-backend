import {Op} from "sequelize";
import {calCount, INTERVAL_TYPE} from "./common/utils";
import {DailyPosRewardStat} from "../model/DailyPosReward";
import {DailyPowRewardStat} from "../model/DailyPowReward";

export class DailyRewardStatQuery {
    public INTERVAL_TYPE = {hour: 'hour', day: 'day', month: 'month'};
    protected app;

    constructor(backendApp: any) {
        this.app = backendApp;
    }

    public async listPowRewardStat({intervalType = 'day', skip, limit, sort, minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyPowRewardStat, ['statTime', ['powReward', 'count'], ['powRewardTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit);
    }

    public async listPosRewardStat({intervalType = 'day', skip, limit, sort, minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyPosRewardStat, ['statTime', ['posReward', 'count'], ['posRewardTotal', 'total']],
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
}
