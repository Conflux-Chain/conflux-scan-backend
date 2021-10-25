import {PosAccount} from "../../model/PoS";
import {col, fn} from 'sequelize'
import {Conflux} from "js-conflux-sdk";
import {Epoch} from "../../model/Epoch";

// noinspection CommaExpressionJS
export class PosQuery {
    private cfx: Conflux;

    constructor(cfx:Conflux) {
        this.cfx = cfx
    }
    async posInfo() {
        const [st, posAccountCount, posEconomics] = await Promise.all([
            // {"epoch":40,"latestCommitted":2397,"latestVoted":2399,"pivotDecision":925080}
            this.cfx['pos'].getStatus(),
            PosAccount.count({}),
            // @ts-ignore
            this.cfx.getPoSEconomics(),
        ])
        const [latestVotedTime,pivotDecisionTime,lastDistributeBlockTime] = await Promise.all([
            Epoch.findByPk(st.latestVoted?.toString() || 0), //
            Epoch.findByPk(st.pivotDecision?.toString() || 0), //
            Epoch.findByPk(posEconomics.lastDistributeBlock?.toString() || 0), //
        ]).then(arr=>arr.map(e=>e?.timestamp.getTime() || 0))
        return {
            latestCommitted: (st.latestCommitted || '0').toString(),
            latestVoted: (st.latestVoted || '0').toString(),
            posPivotDecision: st.pivotDecision?.toString() || '0',
            posEpoch: st.epoch?.toString() || '0',
            posAccountCount: posAccountCount?.toString() || '0',
            distributablePosInterest: posEconomics.distributablePosInterest.toString(),
            lastDistributeBlock: posEconomics.lastDistributeBlock.toString(),
            totalPosStakingTokens: posEconomics.totalPosStakingTokens.toString(),
            latestVotedTime,pivotDecisionTime,lastDistributeBlockTime,
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