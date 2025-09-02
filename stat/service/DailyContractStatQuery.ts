// @ts-ignore
import {format} from "js-conflux-sdk";
import {
    DailyContractCreate,
    DailyContractRegister,
    DailyContractStat,
    IDailyContractStat
} from "../model/DailyContractStat";
import {Hex40Map} from "../model/HexMap";
import {Op} from "sequelize";
import {ConfigInstance} from "../config/StatConfig";

export class DailyContractStatQuery {

    async listContractCreateDaily(skip: number = 0, limit: number = 1000) {
        const query: any = {statType: '1d'}
        const page = await DailyContractCreate.findAndCountAll({
            attributes: ['statDay', 'contractCount', ['contractTotal', 'contractTotalCount']],
            where: query, offset: skip, limit, order:[["statDay", "DESC"]], raw: true
        })
        return page;
    }

    async listContractRegisterDaily(skip: number = 0, limit: number = 1000) {
        const query: any = {statType: '1d'}
        const page = await DailyContractRegister.findAndCountAll({
            attributes: ['statDay', 'contractCount'],
            where: query, offset: skip, limit, order:[["statDay", "DESC"]], raw: true
        })
        return page;
    }

    async listDeployedContractStat({minTimestamp = undefined, maxTimestamp = undefined, sort='asc',
                                       skip = 0, limit = 10}) {
        const queryOptions: any = {
            attributes: [['statDay', 'statTime'], ['contractCount', 'count'], ['contractTotal', 'total']],
            offset: skip,
            limit,
            order: [['statDay', sort]],
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

        const page = await DailyContractCreate.findAndCountAll(queryOptions);
        // @ts-ignore
        page.rows.forEach(row=>{row['statTime'] = row['statTime'].toISOString().replace('T', ' ').substr(0, 19)});
        return {total: page.count, list: page.rows};
    }

    async listStat(address, skip: number = 0, limit: number = 1000) {
        const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(address).substr(2)}})
        const hex40id = hex40?.id
        if(hex40id === undefined){
            return {total: 0};
        }

        const page = await DailyContractStat.findAndCountAll({
            attributes: ['statTime', 'tx', 'cfxTransfer', 'tokenTransfer'],
            where: {hex40id}, offset: skip, limit, order:[["statTime", "DESC"]],
            raw: true,
        })
        if (ConfigInstance.onlyStatActiveContract) {
            page.rows = fillAbsentDay(page.rows, limit);
        }
        return { total: page.count || 0, list: page.rows };
    }
}

function fillAbsentDay(list: IDailyContractStat[], limit: number) {
    if (!list.length) {
        return list;
    }
    // it's desc order by statTime
    const ascArr = []
    let latest = list[0];
    let today = new Date();
    today.setDate(today.getDate() - 2);
    while (latest.statTime < today) {
        let newDay = new Date(latest.statTime);
        newDay.setDate(newDay.getDate() + 1);
        latest = {
            statTime: newDay, tx: 0, cfxTransfer: 0, tokenTransfer: 0,
            hex40id: 0,
        }
        latest['absent'] = true;
        ascArr.push(latest);
    }

    if (!ascArr.length) {
        return list;
    }

    const all = ascArr.reverse();
    all.push(...list);
    return all.slice(0, limit);
}
