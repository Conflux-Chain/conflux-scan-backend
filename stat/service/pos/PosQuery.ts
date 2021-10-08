import {PosAccount} from "../../model/PoS";
import {col, fn} from 'sequelize'
import {Conflux} from "js-conflux-sdk";

// noinspection CommaExpressionJS
export class PosQuery {
    private cfx: Conflux;

    constructor(cfx:Conflux) {
        this.cfx = cfx
    }
    async posInfo() {
        const [st, posAccountCount] = await Promise.all([
            // {"epoch":40,"latestCommitted":2397,"latestVoted":2399,"pivotDecision":925080}
            this.cfx['pos'].getStatus(),
            PosAccount.count({}),
        ])
        return {
            latestCommitted: st.latestCommitted,
            latestVoted: st.latestVoted,
            posPivotDecision: st.pivotDecision,
            posEpoch: st.epoch,
            posAccountCount,
        }
    }
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