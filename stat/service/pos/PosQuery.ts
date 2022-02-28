import {
    PosAccount,
    PosAccountBlock,
    PosBlock,
    PosCommittee, PosDailyStat,
    PosEpochRewardHash,
    PosReward,
    PosTransaction
} from "../../model/PoS";
import {col, fn,Op} from 'sequelize'
import {Conflux} from "js-conflux-sdk";
import {Epoch} from "../../model/Epoch";
import {KV, TOTAL_POS_REWARD} from "../../model/KV";
const lodash = require('lodash')

// noinspection CommaExpressionJS
export class PosQuery {
    private cfx: Conflux;

    constructor(cfx:Conflux) {
        this.cfx = cfx
    }
    async posInfo() {
        const [st, posAccountCount, posEconomics, totalPosRewardDrip, {apy, totalCirculating}] = await Promise.all([
            // {"epoch":40,"latestCommitted":2397,"latestVoted":2399,"pivotDecision":925080}
            this.cfx.pos.getStatus(),
            PosAccount.count({}),
            this.cfx.getPoSEconomics(),
            KV.getString(TOTAL_POS_REWARD, "0"),
            this.calculateApy(),
        ]).catch(err=>{
            if (err.message.includes('PoS chain is not enabled')) {
                return []
            }
            throw err;
        })
        if (st === undefined) {
            return {
                totalPosRewardDrip,
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
                apy: 0, totalCirculating,
            }
        }
        const [latestVotedTime,pivotDecisionTime,lastDistributeBlockTime] = await Promise.all([
            Epoch.findByPk((st.latestVoted||st.latestCommitted)?.toString() || 0), //
            Epoch.findByPk(st.pivotDecision?.height?.toString() || 0), //
            // @ts-ignore
            this.cfx.getBlockByBlockNumber(posEconomics.lastDistributeBlock?.toString() || 0).then(blk=>{
                return {epoch: 0, timestamp: new Date((blk?.timestamp || 0) * 1000)}
            })
        ]).then(arr=>arr.map(e=>e?.timestamp.getTime() || 0))
        return {
            totalPosRewardDrip,
            latestCommitted: (st.latestCommitted || '0').toString(),
            latestVoted: (st.latestVoted || st.latestCommitted || '0').toString(),
            posPivotDecision: st.pivotDecision?.height?.toString() || '0',
            posEpoch: st.epoch?.toString() || '0',
            posAccountCount: posAccountCount?.toString() || '0',
            distributablePosInterest: posEconomics.distributablePosInterest.toString(),
            lastDistributeBlock: posEconomics.lastDistributeBlock.toString(),
            totalPosStakingTokens: posEconomics.totalPosStakingTokens.toString(),
            latestVotedTime,pivotDecisionTime,lastDistributeBlockTime,
            apy, totalCirculating,
        }
    }
    async calculateApy() {
        // https://forum.conflux.fun/t/conflux-pos/13395
        // PoS 质押奖励
        // 现有基础质押利率为 4%，而 PoS 质押奖励在此基础上添加加成系数。设 x=CFX总流通量 /CFX总质押量，加成系数为 √x .
        // 当质押量为流通量的 1/4 时，利率为 8%；当质押量为流通量 1/9 时，利率为 12%；以此类推。当参与投票的总数相对较低时，参与投票的人将获得更多的利益。
        let baseR = BigInt(4)
        const [{totalCirculating}, {totalPosStakingTokens}] = await Promise.all([
            this.cfx.getSupplyInfo('latest_confirmed'),
            this.cfx.getPoSEconomics(),
        ]);
        if (!totalPosStakingTokens) {
            return {apy: 0, totalCirculating};
        }
        let x = baseR *  BigInt(totalCirculating) / BigInt(totalPosStakingTokens);
        const r = Math.sqrt(parseInt(x.toString()))
        return {apy: r, totalCirculating};
    }
    async listPosAccountReward({skip, limit, identifier, orderBy, order}) {
        const account = await PosAccount.findOne({where: {hex: identifier}})
        if (account === null) {
            return {rows:[], count: 0};
        }
        const {rows, count} = await PosReward.findAndCountAll({
            where: {accountId: account.id}, order: [[ orderBy || 'epoch',order]], limit, offset: skip, raw:true,
        });
        if (!rows.length) {
            return {rows, count}
        }
        const epochs = [...new Set(rows.map(r=>r.epoch))];
        const epochHashes = await PosEpochRewardHash.findAll({where:{epoch:{[Op.in]:epochs}},
            // logging: true,
        })
        const hashesMap = lodash.keyBy(epochHashes, r=>r.epoch);
        rows.forEach(row=>{
            row['powBlockHash'] = hashesMap[row.epoch]?.powEpochHash || ''
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
                    // logging: console.log,
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
        let min = 0, max = 0;
        const maxDB:number = await PosBlock.max('height').then(v=>{
            return  (isNaN((Number(v))) ? 0 : v) as number;
        })
        max = maxDB - skip;
        min = max - limit;
        skip = 0;
        const count = maxDB;
        const rows = await PosBlock.findAll({offset: skip, limit, raw: true,
            order: [['height','desc']],
            where: {height:{[Op.between]:[min, max]}}
        })
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
    async listTxInBlock({skip:offset, limit, blockHeight}) {
        const page = await PosTransaction.findAndCountAll({
            attributes: {exclude: ['fromId']},
            where: {blockNumber: blockHeight}, raw: true, offset, limit,
            order: [['number','desc']]
        })
        return page;
    }
    async listTx({skip:offset, limit}) {
        // tx has pk called 'number'
        let min = 0, max = 0;
        const maxDB:number = await PosTransaction.max('number').then(v=>{
            return  (isNaN(Number(v)) ? 0 : v) as number;
        })
        const count = maxDB
        max = maxDB - offset;
        min = max - limit;
        offset = 0;
        const rows= await PosTransaction.findAll({offset, limit, raw:true,
            order: [['number','desc']],
            where: {number:{[Op.between]:[min, max]}},
            // logging: console.log,
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
    async listCommittee({skip:offset, limit}) {
        const page = await PosCommittee.findAndCountAll({
            offset, limit, order: [['blockNumber','desc']], raw: true
        })
        return page;
    }
    async listAccountVoteHistory({skip:offset, limit, identifier, orderBy, order}) {
        const account = await PosAccount.findOne({where: {hex: identifier}})
        if (account === null) {
            return {rows:[], count: 0};
        }
        const {count, rows} = await PosAccountBlock.findAndCountAll({offset, limit, raw:true,
            attributes: ['blockNumber','votes'],
            where: {accountId: account.id},
            order: [[orderBy || 'blockNumber',order || 'desc']]
        })
        if (count) {
            const blockIds = rows.map(row=>row.blockNumber).filter(Boolean)
            if (blockIds.length) {
                const blocks = await PosBlock.findAll({
                    attributes: ['height','hash','createdAt'],
                    where: {height: {[Op.in]: blockIds}}})
                const map = lodash.keyBy(blocks, acc=>acc.height)
                rows.forEach(r=>r['block'] = map[r.blockNumber])
            }
        }
        return {count, rows}
    }
    async listPosDailyStat({skip:offset, limit}) {
        const page = await PosDailyStat.findAndCountAll({offset, limit,
            order: [['statDay','desc']]
        })
        return page;
    }
}