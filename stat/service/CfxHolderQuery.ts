import {DailyCfxHolder} from "../model/DailyCfxHolder";
import {Op} from "sequelize";
import {AddressStat, DailyActiveAddress} from "../model/StatAddress";

export class CfxHolderQuery{

    async listCfxHolderDaily(skip: number = 0, limit: number = 1000) {
        const query: any = {statType: '1d'}
        const page = await DailyCfxHolder.findAndCountAll({
            attributes: ['statDay', 'holderCount'],
            where: query, offset: skip, limit, order:[["statDay", "DESC"]]
        })
        return page;
    }

    async listCfxHolderStat({minTimestamp = undefined, maxTimestamp = undefined, sort='asc',
                                       skip = 0, limit = 10}) {
        const queryOptions: any = {
            attributes: [['statDay', 'statTime'], ['holderCount', 'count']],
            order: [['statDay', sort]],
            offset: skip,
            limit,
            raw: true,
        };

        const conditionArray: any[] = [{statType: '1d'}];
        if (minTimestamp !== undefined) {
            conditionArray.push({statDay: {[Op.gte]: new Date(minTimestamp*1000)}});
        }
        if (maxTimestamp !== undefined) {
            conditionArray.push({statDay: {[Op.lte]: new Date(maxTimestamp*1000)}});
        }
        if(conditionArray.length === 1){
            queryOptions.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            queryOptions.where = {[Op.and]: conditionArray};
        }

        const page = await DailyCfxHolder.findAndCountAll(queryOptions);
        // @ts-ignore
        page.rows.forEach(row=>{row['statTime'] = row['statTime'].toISOString().replace('T', ' ').substr(0, 19)});
        return {total: page.count, list: page.rows};
    }

    async listAccountGrowthStat({minTimestamp = undefined, maxTimestamp = undefined, sort='asc',
                                skip = 0, limit = 10}) {
        const queryOptions: any = {
            attributes: [['day', 'statTime'], ['cnt', 'count']],
            order: [['day', sort]],
            offset: skip,
            limit,
            raw: true,
            // logging: msg => console.log(`listAccountGrowthStat: ${msg}`),
        };

        const conditionArray = [];
        if (minTimestamp !== undefined) {
            conditionArray.push({day: {[Op.gte]: new Date(minTimestamp*1000)}});
        }
        if (maxTimestamp !== undefined) {
            conditionArray.push({day: {[Op.lte]: new Date(maxTimestamp*1000)}});
        }
        if(conditionArray.length === 1){
            queryOptions.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            queryOptions.where = {[Op.and]: conditionArray};
        }

        const page = await AddressStat.findAndCountAll(queryOptions);
        // @ts-ignore
        page.rows.forEach(row=>{row['statTime'] = new Date(row['statTime']).toISOString().replace('T', ' ').substr(0, 19)});
        return {total: page.count, list: page.rows};
    }

    async listAccountActiveStat({minTimestamp = undefined, maxTimestamp = undefined, sort='asc',
                                    skip = 0, limit = 10}) {
        const queryOptions: any = {
            attributes: [['day', 'statTime'], ['cnt', 'count']],
            order: [['day', sort]],
            offset: skip,
            limit,
            raw: true,
        };

        const conditionArray = [];
        if (minTimestamp !== undefined) {
            conditionArray.push({day: {[Op.gte]: new Date(minTimestamp*1000)}});
        }
        if (maxTimestamp !== undefined) {
            conditionArray.push({day: {[Op.lte]: new Date(maxTimestamp*1000)}});
        }
        if(conditionArray.length === 1){
            queryOptions.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            queryOptions.where = {[Op.and]: conditionArray};
        }

        const page = await DailyActiveAddress.findAndCountAll(queryOptions);
        // @ts-ignore
        page.rows.forEach(row=>{row['statTime'] = new Date(row['statTime']).toISOString().replace('T', ' ').substr(0, 19)});
        return {total: page.count, list: page.rows};
    }
}
