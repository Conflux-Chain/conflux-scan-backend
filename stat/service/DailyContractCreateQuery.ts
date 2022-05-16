import {DailyContractCreate} from "../model/DailyContractCreate";
import {Op} from "sequelize";
import {DailyBlockDataStat} from "../model/DailyBlockDataStat";

export class DailyContractCreateQuery{

    async listContractCreateDaily(skip: number = 0, limit: number = 1000) {
        const query: any = {}
        const page = await DailyContractCreate.findAndCountAll({
            attributes: ['statDay', 'contractCount', ['contractTotal', 'contractTotalCount']],
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
            logging: msg => console.log(`listDeployedContractStat: ${msg}`),
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

        const page = await DailyContractCreate.findAndCountAll(queryOptions);
        // @ts-ignore
        page.rows.forEach(row=>{row['statTime'] = row['statTime'].toISOString().replace('T', ' ').substr(0, 19)});
        return {total: page.count, list: page.rows};
    }
}