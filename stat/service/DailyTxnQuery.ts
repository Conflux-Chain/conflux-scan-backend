import {DailyTransaction} from "../model/DailyTransaction";
import {col, fn, Op} from "sequelize";
import {DailyCfxTxn} from "../model/CfxTransfer";
import {DailyTokenTxn, T_DAILY_TOKEN_TXN} from "../model/Erc20Transfer";
import {DailyToken, Token} from "../model/Token";
import {Errors} from "./common/LogicError";
import {format} from "js-conflux-sdk";
import {StatApp} from "../StatApp";

export class DailyTxnQuery{

    async listTxnDaily(skip: number = 0, limit: number = 1000) {
        const query: any = {statType: '1d'}
        const page = await DailyTransaction.findAndCountAll({
            attributes: ['statDay', 'txCount'],
            where: query, offset: skip, limit, order:[["statDay", "DESC"]]
        })
        // fix the end time to previous day.
        // page.rows.forEach(row=>row.statDay.setDate(row.statDay.getDate()-1))
        return page;
    }

    async listDailyTransactionStat({minTimestamp = undefined, maxTimestamp = undefined, sort='asc',
                                    skip = 0, limit = 10, field}) {
        const queryOptions: any = {
            attributes: [['statDay', 'statTime'], [field, 'count']],
            order: [['statDay', sort]],
            offset: skip,
            limit,
            raw: true,
            // logging: msg => console.log(`listDailyTransactionStat: ${msg}`),
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

        const page = await DailyTransaction.findAndCountAll(queryOptions);
        // @ts-ignore
        page.rows.forEach(row=>{row['statTime'] = new Date(row['statTime']).toISOString().replace('T', ' ').substr(0, 19)});
        return {total: page.count, list: page.rows};
    }

    async listDailyCfxTransferStat({minTimestamp = undefined, maxTimestamp = undefined, sort='asc',
                                       skip = 0, limit = 10}) {
        const queryOptions: any = {
            attributes: [['day', 'statTime'], ['txnCount', 'transferCount'], 'userCount', 'amount'],
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

        const page = await DailyCfxTxn.findAndCountAll(queryOptions);
        // @ts-ignore
        page.rows.forEach(row=>{row['statTime'] = new Date(row['statTime']).toISOString().replace('T', ' ').substr(0, 19)});
        return {total: page.count, list: page.rows};
    }

    async listDailyTokenTransferStat({minTimestamp = undefined, maxTimestamp = undefined, sort='asc',
                                       skip = 0, limit = 10}) {
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

    async listDailyTokenAnalysis({minTimestamp = undefined, maxTimestamp = undefined, sort='asc',
                                         skip = 0, limit = 10, contract}) {
        const base32 = format.address(contract, StatApp.networkId);
        const token = await Token.findOne({
            attributes: ['name', 'symbol', 'decimals', 'granularity', 'totalSupply', 'type', 'hex40id'],
            where: {base32},
        });
        if (!token) {
            throw new Errors.ParameterError(`Token ${contract} not found.`)
        }

        const queryOptions: any = {
            attributes: [
                ['day', 'statTime'],
                ['uniqueSender', 'uniqueSenderCount'],
                ['uniqueReceiver', 'uniqueReceiverCount'],
                ['participants', 'uniqueParticipantCount'],
                'transferCount',
                'holderCount',
            ],
            order: [['day', sort]],
            offset: skip,
            limit,
            raw: true,
            logging: msg => console.log(`listDailyTokenTransferParticipantStat: ${msg}`),
        };

        const conditionArray = [];
        conditionArray.push({hexId: token.hex40id});
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

        const page: any = await DailyToken.findAndCountAll(queryOptions);
        // @ts-ignore
        page.rows.forEach(row=>{row['statTime'] = new Date(row['statTime']).toISOString().replace('T', ' ').substr(0, 19)});
        return {total: page.count, list: page.rows};
    }
}