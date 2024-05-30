// @ts-ignore
import {format} from "js-conflux-sdk";
import {DailyContractCreate, DailyContractRegister, DailyContractStat} from "../model/DailyContractStat";
import {Hex40Map} from "../model/HexMap";
import {Op} from "sequelize";

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
            where: {hex40id}, offset: skip, limit, order:[["statTime", "DESC"]]
        })
        return { total: page?.count || 0, list: page?.rows };;
    }
}
