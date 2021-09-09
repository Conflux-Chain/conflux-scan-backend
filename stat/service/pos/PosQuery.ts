import {PosAccount} from "../../model/PoS";
import {col, fn} from 'sequelize'

// noinspection CommaExpressionJS
export class PosQuery {
    async listPosAccount({sortBy = 'id', sort = 'DESC', skip = 0, limit = 10,
                             groupByPowAddress=false}) {
        if (groupByPowAddress) {
            return Promise.all([
                PosAccount.findAll({
                    attributes:[
                        // 'id', 'hex',
                        'powBase32',
                        [fn('sum', col('signCount')), 'signCount'],
                        [fn('sum', col('mineCount')), 'mineCount'],
                    ],
                    group: ['powBase32'],
                    offset: skip, limit, raw: true,
                    order: [[fn('sum', col(sortBy)), sort]],
                    logging: console.log,
                }),
                PosAccount.count({col: 'powBase32',
                    distinct: true,
                })
            ]).then(([rows, count])=>{
                return {rows, count}
            })
        }
        return await PosAccount.findAndCountAll({
            where: {},
            offset: skip, limit, raw: true,
            order: [[sortBy, sort]]
        })
    }
}