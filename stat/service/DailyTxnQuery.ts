import {DailyTransaction} from "../model/DailyTransaction";

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
}