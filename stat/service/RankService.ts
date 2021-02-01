import {STATE_OK, T_TOP_BATCH_INDEX, T_TOP_RECORD, TopBatchIndex} from "../model/TopRecord";
import {Sequelize, QueryTypes} from "sequelize";
import {pickNumber} from "../model/Utils";

export class RankService{
    private sequelize: Sequelize;
    constructor(seq) {
        this.sequelize = seq;
    }
    async top(type: string, limit: number = 10) : Promise<any[]> {
        limit = pickNumber(limit, 10)
        const newLine = ''
        const maxBatchId:number = await TopBatchIndex.max('id',
            {where: {type: type, state: STATE_OK}})
        if (isNaN(maxBatchId)) {
            console.log(`max batch id not found. type ${type}`)
            return Promise.resolve([])
        }
        const sql = `select hex, valueN, \`rank\`, begin_time, end_time from ${T_TOP_RECORD} JOIN ${T_TOP_BATCH_INDEX
        } ON batchId=\`${T_TOP_BATCH_INDEX}\`.id join hex40 on hex40.id = addressId ${
        newLine} where batchId=? order by \`rank\` limit ?`;
        console.log(`sql is : ${sql}`)
        const list = await this.sequelize.query(sql, {
            replacements: [maxBatchId, limit],
            type: QueryTypes.SELECT,
            benchmark: true, logging: console.log
        })
        return list;
    }
}