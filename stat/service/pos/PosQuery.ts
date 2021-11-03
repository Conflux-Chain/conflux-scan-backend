import {PosAccount, PosBlock, PosEpochRewardHash, PosReward, PosTransaction} from "../../model/PoS";
import {col, fn,Op} from 'sequelize'
import {Conflux} from "js-conflux-sdk";
import {Epoch} from "../../model/Epoch";
const lodash = require('lodash')

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
        ]).catch(err=>{
            if (err.message.includes('PoS chain is not enabled')) {
                return []
            }
            throw err;
        })
        if (st === undefined) {
            return {
                latestCommitted: '0',
                latestVoted:  '0',
                posPivotDecision:  '0',
                posEpoch: '0',
                posAccountCount: '0',
                distributablePosInterest:  '0',
                lastDistributeBlock:  '0',
                totalPosStakingTokens:  '0',
                latestVotedTime:0,pivotDecisionTime:0,lastDistributeBlockTime:0,
                waitPosEnable: true,
            }
        }
        const [latestVotedTime,pivotDecisionTime,lastDistributeBlockTime] = await Promise.all([
            Epoch.findByPk((st.latestVoted||st.latestCommitted)?.toString() || 0), //
            Epoch.findByPk(st.pivotDecision?.toString() || 0), //
            // @ts-ignore
            this.cfx.getBlockByBlockNumber(posEconomics.lastDistributeBlock?.toString() || 0).then(blk=>{
                return {epoch: 0, timestamp: new Date((blk?.timestamp || 0) * 1000)}
            })
        ]).then(arr=>arr.map(e=>e?.timestamp.getTime() || 0))
        return {
            latestCommitted: (st.latestCommitted || '0').toString(),
            latestVoted: (st.latestVoted || st.latestCommitted || '0').toString(),
            posPivotDecision: st.pivotDecision?.toString() || '0',
            posEpoch: st.epoch?.toString() || '0',
            posAccountCount: posAccountCount?.toString() || '0',
            distributablePosInterest: posEconomics.distributablePosInterest.toString(),
            lastDistributeBlock: posEconomics.lastDistributeBlock.toString(),
            totalPosStakingTokens: posEconomics.totalPosStakingTokens.toString(),
            latestVotedTime,pivotDecisionTime,lastDistributeBlockTime,
        }
    }
    async listPosAccountReward({skip, limit, identifier}) {
        const account = await PosAccount.findOne({where: {hex: identifier}})
        if (account === null) {
            return {rows:[], count: 0};
        }
        const {rows, count} = await PosReward.findAndCountAll({
            where: {accountId: account.id}, order: [['epoch','desc']], limit, offset: skip, raw:true,
        });
        if (!rows.length) {
            return {rows, count}
        }
        const epochs = [...new Set(rows.map(r=>r.epoch))];
        const epochHashes = await PosEpochRewardHash.findAll({where:{epoch:{[Op.in]:epochs}}})
        const hashesMap = lodash.keyBy(epochHashes, r=>r.epoch);
        rows.forEach(row=>{
            row['powBlockHash'] = hashesMap[row.epoch]?.powBlockHash || ''
        })
        return {rows, count}
    }
    async getAccountDetail(identifier:string) {
        const [dbInfo, onChainInfo, {currentCommittee}] = await Promise.all([
            PosAccount.findOne({where: {hex: identifier}}),
            this.cfx.pos.getAccount(identifier).catch(err=>{
                return {status:{forceRetired: 0, waitPosEnable: true}}
            }),
            this.cfx.pos.getCommittee().catch(err=>{
                return {currentCommittee:{nodes:[]}}
            }),
        ])
        const map = lodash.keyBy(currentCommittee.nodes, n=>n.address);
        return {
            ...onChainInfo.status,
            forceRetired: onChainInfo.status.forceRetired || 0,
            createdAt: dbInfo?.createdAt || new Date(),
            totalReward: dbInfo?.totalReward || 0,
            committeeInfo: map[identifier] || {votingPower: 0}
        }
    }
    async listPosAccountWithCurrentCommittee(query) {
        const [page, {currentCommittee}] = await Promise.all([
            this.listPosAccount(query),
            this.cfx.pos.getCommittee().catch(err=>{
                return {currentCommittee:{nodes:[]}}
            }),
        ])
        const map = lodash.keyBy(currentCommittee.nodes, n=>n.address);
        page.rows.forEach(row=>{
            row['committeeInfo'] = map[row.hex] || {votingPower: 0}
        })
        return page;
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
    async listBlock({skip, limit}) {
        const {count, rows} = await PosBlock.findAndCountAll({offset: skip, limit, raw: true,
            order: [['height','desc']]})
        if (count) {
            const minerIds = rows.map(row=>row.minerId).filter(Boolean)
            if (minerIds.length) {
                const accounts = await PosAccount.findAll({
                    attributes: ['hex','id'],
                    where: {id: {[Op.in]: minerIds}}})
                const map = lodash.keyBy(accounts, acc=>acc.id)
                rows.forEach(r=>r['miner'] = map[r.minerId])
            }
        }
        return {count, rows}
    }

    async listTx({skip:offset, limit}) {
        const {count, rows} = await PosTransaction.findAndCountAll({offset, limit, raw:true,
            order: [['number','desc']]
        })
        if (count) {
            const blockIds = rows.map(row=>row.blockNumber).filter(Boolean)
            if (blockIds.length) {
                const blocks = await PosBlock.findAll({
                    attributes: ['height','hash'],
                    where: {height: {[Op.in]: blockIds}}})
                const map = lodash.keyBy(blocks, acc=>acc.height)
                rows.forEach(r=>r['block'] = map[r.blockNumber])
            }
        }
        return {count, rows}
    }
}