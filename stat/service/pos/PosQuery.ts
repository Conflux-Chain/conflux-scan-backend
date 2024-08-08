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
import {Conflux, Drip} from "js-conflux-sdk";
import {Epoch} from "../../model/Epoch";
import {KV, TOTAL_POS_REWARD} from "../../model/KV";
import {Errors} from "../common/LogicError";
const lodash = require('lodash')
const BigFixed = require('bigfixed');
import {buildSqlLog, } from "../../../common/tool.js";
import {StatApp} from "../../StatApp";
import {loadCache, PATH_POS_INFO, resolveDockerPath, writeCache} from "../CacheService";
// noinspection CommaExpressionJS
export class PosQuery {
    public cfx: Conflux;
    private cachedData: Object
    private whereCondForValidators: any = {
        [Op.or]: [
            {availableVotes: {[Op.gt]: 0}}, // active
            {forceRetiredVotes: {[Op.gt]: 0}}, // inactive
        ],
    }

    constructor(cfx:Conflux) {
        this.cfx = cfx
        const that = this;
        if (StatApp.isEVM) {
            return
        }
        async function repeat() {
            try {
                that.cachedData = await that.posInfoReal()
            } catch (e) {
                console.log(`update pos info error:`, e)
            }
            setTimeout(repeat, 10_000)
        }
        repeat().then()
    }
    async posInfo() {
        return this.cachedData || {}
    }
    async posInfoReal() {
        const cachePath = resolveDockerPath(PATH_POS_INFO)
        // if cached data is not set, then load cache without checking expiration
        const cachedData = loadCache(cachePath, this.cachedData ? 10 : 0)
        if (cachedData) {
            return cachedData
        }
        const [st, posAccountCount, posEconomics, totalPosRewardDrip, {apy, totalCirculating}] = await Promise.all([
            // {"epoch":40,"latestCommitted":2397,"latestVoted":2399,"pivotDecision":925080}
            this.cfx.pos.getStatus(),
            PosAccount.count({where: this.whereCondForValidators}),
            this.cfx.getPoSEconomics('latest_confirmed'),
            KV.getString(TOTAL_POS_REWARD, "0"),
            PosQuery.calculateApy(this.cfx),
        ]).catch(err=>{
            if (err.message.includes('PoS chain is not enabled')) {
                return []
            }
            throw new Errors.BizError(`posInfo error: ${err.message}`);
        });
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
        const result = {
            totalPosRewardDrip,
            latestCommitted: (st.latestCommitted || '0').toString(),
            latestVoted: (st.latestVoted || st.latestCommitted || '0').toString(),
            posPivotDecision: st.pivotDecision?.height?.toString() || '0',
            posEpoch: st.epoch?.toString() || '0',
            posAccountCount: posAccountCount?.toString() || '0',
            distributablePosInterest: posEconomics.distributablePosInterest.toString(),
            lastDistributeBlock: posEconomics.lastDistributeBlock.toString(),
            totalPosStakingTokens: posEconomics.totalPosStakingTokens.toString(),
            latestVotedTime, pivotDecisionTime, lastDistributeBlockTime,
            apy, totalCirculating,
            updatedAt: new Date().toISOString(),
        };
        writeCache(cachePath, result)
        return result
    }
    static async calculateApy(cfx: Conflux, epoch: string|number = 'latest_confirmed') {
        // https://forum.conflux.fun/t/conflux-pos/13395
        // PoS 质押奖励
        // 现有基础质押利率为 4%，而 PoS 质押奖励在此基础上添加加成系数。设 x=CFX总流通量 /CFX总质押量，加成系数为 √x .
        // 当质押量为流通量的 1/4 时，利率为 8%；当质押量为流通量 1/9 时，利率为 12%；以此类推。当参与投票的总数相对较低时，参与投票的人将获得更多的利益。
        let baseR = 4
        const [{totalCirculating}, {totalPosStakingTokens}] = await Promise.all([
            cfx.getSupplyInfo(epoch),
            cfx.getPoSEconomics(epoch),
        ]);
        if (!totalPosStakingTokens) {
            return {apy: 0, totalCirculating};
        }
        let x = parseFloat(new Drip(totalCirculating.toString()).toCFX()) / parseFloat(new Drip(totalPosStakingTokens.toString()).toCFX());
        const r = baseR *  Math.sqrt(x)
        return {apy: r, totalCirculating, totalPosStakingTokens};
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
    async listPosAccountWithCurrentCommitteeNew(query) {
        const [page, {currentCommittee}] = await Promise.all([
            this.listPosAccount(query),
            this.cfx.pos.getCommittee().catch(err=>{
                return {currentCommittee:{nodes:[]}}
            }),
        ])
        const map = lodash.keyBy(currentCommittee.nodes, n=>n.address);
        const tvp = currentCommittee.totalVotingPower
        let index = (query?.order === 'desc') ? query.skip : (page.count - query.skip)
        page.rows.forEach(row=>{
            // `Rank` field, only when `query.orderBy` is `availableVotes`.
            if(query?.orderBy === 'availableVotes') {
                if(query?.order === 'desc') {
                    row['rank'] = ++index
                } else{
                    row['rank'] = index--
                }
            }
            // `Voting Power` field.
            row['availableVotesInCfx'] = row.availableVotes * 1000
            // `Active` field.
            row['forceRetired'] = row['forceRetiredVotes']
            row['forceRetiredVotes'] = undefined
            // `Voting Share` field.
            const ci: any = map[row.hex] || {votingPower: 0}
            ci.totalVotingPower = tvp
            ci.votingShare = BigFixed(ci.votingPower).div(BigFixed(tvp)).toNumber()
            row['committeeInfo'] = ci
        })
        return page;
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
    async listPosAccount({orderBy = 'id', order = 'desc', skip = 0, limit = 10,
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
                    where: this.whereCondForValidators,
                    group: ['powBase32'],
                    offset: skip, limit, raw: true,
                    order: [[fn('sum', col(orderBy)), order]],
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
            where: this.whereCondForValidators,
            offset: skip, limit, raw: true,
            order: [[orderBy, order]],
            //logging: buildSqlLog('list pos account sql:'), benchmark: true
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
