import {DailyContractCreate} from "../model/DailyContractCreate";

export class DailyContractCreateQuery{

    async listContractCreateDaily(skip: number = 0, limit: number = 1000) {
        const query: any = {}
        const page = await DailyContractCreate.findAndCountAll({
            attributes: ['statDay', 'contractCount'],
            where: query, offset: skip, limit, order:[["statDay", "DESC"]], raw: true
        })
        return page;
    }
}