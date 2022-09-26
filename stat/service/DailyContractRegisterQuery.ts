import {DailyContractRegister} from "../model/DailyContractRegister";

export class DailyContractRegisterQuery{

    async listContractRegisterDaily(skip: number = 0, limit: number = 1000) {
        const query: any = {statType: '1d'}
        const page = await DailyContractRegister.findAndCountAll({
            attributes: ['statDay', 'contractCount'],
            where: query, offset: skip, limit, order:[["statDay", "DESC"]], raw: true
        })
        return page;
    }
}