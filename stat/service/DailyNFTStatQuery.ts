import {Op} from "sequelize";
import {DailyNFTStat} from "../model/DailyNFTStat";
import {calCount} from "./common/utils";
import {DailyNFTHolder} from "../model/DailyNFTHolder";

export class DailyNFTStatQuery {
    public INTERVAL_TYPE = {min: 'min', hour: 'hour', day: 'day'};
    protected app;

    constructor(backendApp: any) {
        this.app = backendApp;
    }

    public async listNFTAssetStat({intervalType = 'hour', skip = 0, limit = 10, sort='desc',
                               minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyNFTStat, ['statTime', ['nftAsset', 'count'], ['nftAssetTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit);
    }

    public async listNFTContractStat({intervalType = 'hour', skip = 0, limit = 10, sort='desc',
                                  minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyNFTStat, ['statTime', ['nftContract', 'count'], ['nftContractTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit);
    }

    public async listNFTTransferStat({intervalType = 'hour', skip = 0, limit = 10, sort='desc',
                               minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyNFTStat, ['statTime', ['nftTransfer', 'count'], ['nftTransferTotal', 'total']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit);
    }

    public async listNFTHolderStat({intervalType = 'day', skip = 0, limit = 10, sort='desc',
                                         minTimestamp = undefined, maxTimestamp = undefined}) {
        return this.listStatByAttributeArray(DailyNFTHolder, ['statTime', ['holderCount', 'count']],
            intervalType, minTimestamp, maxTimestamp, sort, skip, limit);
    }

    private async listStatByAttributeArray(model, attributeArray: any[], intervalType: string, minTimestamp: number,
                                           maxTimestamp: number, sort: string, skip: number, limit: number) {
        let statType;
        switch (intervalType) {
            case this.INTERVAL_TYPE.day:
                statType = '1d';
                break;
            case this.INTERVAL_TYPE.hour:
                statType = '1h';
                break;
            case this.INTERVAL_TYPE.min:
                statType = '1m';
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

        const count = calCount(minTimestamp, maxTimestamp, intervalType);
        const rows = await model.findAll(queryOptions);
        rows.forEach(row => {
            // @ts-ignore
            row['statTime'] = row['statTime'].toISOString().replace('T', ' ').substr(0, 19);
        });
        const page = {count, rows};
        return {total: page.count, list: page.rows, intervalType};
    }
}
