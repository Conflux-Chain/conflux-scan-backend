import {DailyTransaction} from "../model/DailyTransaction";
import {col, fn, Op} from "sequelize";
import {DailyCfxTxn} from "../model/CfxTransfer";
import {DailyTokenTxn, T_DAILY_TOKEN_TXN} from "../model/Erc20Transfer";

export class DailyTxnQuery{

    async listTxnDaily(skip: number = 0, limit: number = 1000) {
        const query: any = {}
        const page = await DailyTransaction.findAndCountAll({
            attributes: ['statDay', 'txCount'],
            where: query, offset: skip, limit, order:[["statDay", "DESC"]]
        })
        // fix the end time to previous day.
        // page.rows.forEach(row=>row.statDay.setDate(row.statDay.getDate()-1))
        return page;
    }

    async listDailyTransactionStat({minTimestamp = undefined, maxTimestamp = undefined, sort='asc',
                                    skip = 0, limit = 100}) {
        const queryOptions: any = {
            attributes: [['statDay', 'statTime'], ['txCount', 'count']],
            order: [['statDay', sort]],
            offset: skip,
            limit,
            raw: true,
            logging: msg => console.log(`listDailyTransactionStat: ${msg}`),
        };

        const conditionArray = [];
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

        const page = await DailyTransaction.findAndCountAll(queryOptions);
        // @ts-ignore
        page.rows.forEach(row=>{row['statTime'] = new Date(row['statTime']).toISOString().replace('T', ' ').substr(0, 19)});
        return {total: page.count, list: page.rows};
    }

    async listDailyCfxTransferStat({minTimestamp = undefined, maxTimestamp = undefined, sort='asc',
                                       skip = 0, limit = 100}) {
        const queryOptions: any = {
            attributes: [['day', 'statTime'], ['txnCount', 'transferCount'], 'userCount', 'amount'],
            order: [['day', sort]],
            offset: skip,
            limit,
            raw: true,
            logging: msg => console.log(`listDailyCfxTransferStat: ${msg}`),
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

        const page = await DailyCfxTxn.findAndCountAll(queryOptions);
        // @ts-ignore
        page.rows.forEach(row=>{row['statTime'] = new Date(row['statTime']).toISOString().replace('T', ' ').substr(0, 19)});
        return {total: page.count, list: page.rows};
    }

    async listDailyTokenTransferStat({minTimestamp = undefined, maxTimestamp = undefined, sort='asc',
                                       skip = 0, limit = 100}) {
        const queryOptions: any = {
            attributes: [
                ['day', 'statTime'],
                [fn('sum', col('txnCount')), 'transferCount'],
                [fn('sum', col('userCount')), 'userCount'],
            ],
            group: 'day',
            order: [['day', sort]],
            offset: skip,
            limit,
            raw: true,
            logging: msg => console.log(`listDailyTokenTransferStat: ${msg}`),
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

        const page: any = await DailyTokenTxn.findAndCountAll(queryOptions);
        // @ts-ignore
        page.rows.forEach(row=>{row['statTime'] = new Date(row['statTime']).toISOString().replace('T', ' ').substr(0, 19)});
        return {total: page.count.length, list: page.rows};
    }
}