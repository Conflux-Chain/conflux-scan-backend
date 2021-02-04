import {STATE_OK, T_TOP_BATCH_INDEX, T_TOP_RECORD, TopBatchIndex, TopRecord} from "../model/TopRecord";
import {Sequelize, QueryTypes} from "sequelize";
import {pickNumber} from "../model/Utils";
import {ADDR_INFO_STATE_OK, T_ADDRESS, T_ADDRESS_INFO} from "../model/HexMap";
// @ts-ignore
import {format} from 'js-conflux-sdk'

export class RankService{
    private sequelize: Sequelize;
    constructor(seq) {
        this.sequelize = seq;
    }
    async top(type: string, limit: number = 10, networkId: number = 1029) : Promise<any> {
        limit = pickNumber(limit, 10)
        const newLine = ''
        const maxBatchId:number = await TopBatchIndex.max('id',
            {where: {type: type, state: STATE_OK}})
        if (isNaN(maxBatchId)) {
            console.log(`max batch id not found. type ${type}`)
            return Promise.resolve({code: 501, list:[], total: 0, message:'no data'})
        }
        const batchDesc = await TopBatchIndex.findByPk(maxBatchId);
        const t_addr = T_ADDRESS
        const sql = `select hex40 as hex, \`value\` as valueN, valueDesc, ${newLine
        }value2, value2desc, value3, value3desc, value4, value4desc \`percent\`, \`rank\`, ${T_ADDRESS_INFO}.name, ${T_ADDRESS_INFO}.state as nameState, ${newLine
        } begin_time, end_time from ${T_TOP_RECORD
        } JOIN ${T_TOP_BATCH_INDEX
        } ON batch_id=\`${T_TOP_BATCH_INDEX}\`.id left join ${t_addr} on ${t_addr}.id = address_id ${
        newLine} left join ${T_ADDRESS_INFO} on ${t_addr}.id = ${T_ADDRESS_INFO}.id ${newLine
        } where batch_id=? order by \`rank\` limit ?`;
        // console.log(`sql is : ${sql}`)
        const list:any[] = await this.sequelize.query(sql, {
            replacements: [maxBatchId, limit],
            type: QueryTypes.SELECT,
            benchmark: true, logging: console.log
        })
        list.forEach(r=>{
            r.name = r.nameState === ADDR_INFO_STATE_OK ? r.name : null
            r.hex = `0x${r.hex}`
            r.base32address = format.address(r.hex, networkId)
        })
        const count = await TopRecord.count({where: {batchId: maxBatchId}})
        return {code: 0, total: count, batchDesc, list};
    }
}