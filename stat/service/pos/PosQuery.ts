import {
    PosAccount,
    PosAccountBlock,
    PosBlock,
    PosCommittee, PosDailyStat,
    PosEpochRewardHash,
    PosReward,
    PosTransaction
} from "../../model/PoS";
import {col, fn, Op, QueryTypes} from 'sequelize'
import {Conflux, Drip} from "js-conflux-sdk";
import {Epoch} from "../../model/Epoch";
import {KV, TOTAL_POS_REWARD} from "../../model/KV";
import {Errors} from "../common/LogicError";
import {StatApp} from "../../StatApp";
import {loadCache, PATH_POS_INFO, resolveDockerPath, writeCache} from "../CacheService";
import {NameTag} from "../../model/NameTag";

const lodash = require('lodash')
const BigFixed = require('bigfixed')
const {abi} = require('../abi/PosPool')

// noinspection CommaExpressionJS
export class PosQuery {
    public cfx: Conflux;
    private contract;
    private cachedData: Object
    private whereCondForValidators: any = {
        [Op.or]: [
            {availableVotes: {[Op.gt]: 0}}, // active
            {forceRetiredVotes: {[Op.gt]: 0}}, // force retiring
            {[Op.and]: [ // retiring
                    {availableVotes: 0},
                    {unlockingVotes: {[Op.gt]: 0}},
            ]},
        ],
    }

    constructor(cfx:Conflux) {
        this.cfx = cfx
        this.contract = cfx.Contract({abi})
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
    async getAccountOverview(posAddress: string) {
        const [accountDB, account] = await Promise.all([
            PosAccount.findOne({where: {hex: posAddress}}),
            this.cfx.pos.getAccount(posAddress).catch(() => ({status:{}})),
        ])
        if(!accountDB) {
            return new AccountOverview(posAddress)
        }

        // pool contract
        const base32 = accountDB.powBase32
        const poolName = await this.contract.poolName().call({to: base32}).catch(() => undefined)

        // name tag/node type
        const tag = await NameTag.findOne({attributes: ['nameTag', 'website'],
            where: {base32: posAddress.substr(2)}, raw: true})
        const type = tag?.nameTag?.includes(NodeType.Public) ? NodeType.Public : NodeType.Personal
        if(tag?.nameTag) {
            tag.nameTag = tag.nameTag.replace('(Public Pos Pool)', '').replace('(Personal Node)', '')
        }

        // availableVotes/withdrawable/locking/unlocking votes/total reward
        const availableVotesInCfx = account.status.availableVotes * 1000
        const withdrawableInCfx =  account.status.locked  * 1000
        const countVotes = queue => queue.map(item => item.power).reduce((a, b) => a + b, 0)
        const lockingInCfx = countVotes(account.status.inQueue) * 1000
        const unlockingInCfx = countVotes(account.status.outQueue) * 1000
        const totalReward = accountDB?.totalReward || 0

        // status
        let status
        if(account.status.availableVotes > 0) {
            status = NodeStatus.Active
        } else if(account.status.forceRetired > 0) {
            status = NodeStatus.ForceRetiring
        } else if(account.status.availableVotes === 0 && unlockingInCfx > 0) {
            status = NodeStatus.Retiring
        } else if(account.status.forfeited) {
            status = NodeStatus.Forfeited
        } else {
            status = NodeStatus.HistoricalNode
        }

        // pool info
        let poolInfo
        if(type === NodeType.Public) {
            poolInfo = {address: base32, name: poolName}
        }

        return {
            address: posAddress,
            byte32NameTagInfo: tag,
            createdAt: accountDB.createdAt,
            type,
            status,
            availableVotesInCfx,
            withdrawableInCfx,
            lockingInCfx,
            unlockingInCfx,
            poolInfo,
            forceRetired: account.status.forceRetired,
            totalReward,

        } as AccountOverview
    }
    // Supports sorting by availableVotes/votingPower/createdAt/updatedAt
    async listPosAccountWithCommittee({orderBy = 'availableVotes', order = 'desc', skip = 0, limit = 10}) {
        const committee = await PosCommittee.findOne({
            attributes: ["epochNumber", "totalVotingPower"], order: [["epochNumber", 'desc']], raw: true})
        if(!committee) {
            return {count:0, rows:[]}
        }

        const sqlSelect = `select account.*, node.votingPower from`
        const sqlTmpTable = `
        (
            SELECT 
                (@row_number:=@row_number + 1) AS rankAvailableVotes, t.*
            FROM
                (select id, hex, availableVotes, forceRetiredVotes, unlockingVotes, forfeitedVotes, createdAt, updatedAt
                from pos_account where availableVotes > 0 or forceRetiredVotes > 0 or (availableVotes = 0  and unlockingVotes > 0) order by availableVotes desc) t, 
                (select @row_number := 0) r
        ) account
        left join (select accountId, votingPower from pos_committee_node where epochNumber = ?) node
        on account.id = node.accountId`
        const sqlOrder =`order by ${orderBy} ${order}, rankAvailableVotes ${order === 'desc' ? 'asc' : 'desc'}, id desc limit ?,?`
        const sqlCounter = `select count(*) as cntr from`

        const sqlQuery = `${sqlSelect} ${sqlTmpTable} ${sqlOrder}`
        const sqlCount = `${sqlCounter} ${sqlTmpTable}`
        const rows: any[] = await PosAccount.sequelize.query(sqlQuery,{
            type: QueryTypes.SELECT, replacements: [committee.epochNumber, skip, limit], raw: true})
        const count = await PosAccount.sequelize.query(sqlCount,{
            type: QueryTypes.SELECT, replacements: [committee.epochNumber], raw: true}).then(list => {
            return Number(list[0]['cntr'])
        })

        rows.forEach(row => {
            delete row['id']
            // `Voting Power`
            row['availableVotesInCfx'] = row.availableVotes * 1000
            // `Committee Voting Share`
            row['committeeInfo'] = {
                totalVotingPower: committee.totalVotingPower,
                votingPower: row.votingPower || 0,
                votingShare: BigFixed(row.votingPower || 0).div(BigFixed(committee.totalVotingPower)).toNumber()
            }
            delete row['votingPower']
            // `Status`
            let status
            if(row.availableVotes > 0) {
                status = NodeStatus.Active
            } else if(row.forceRetiredVotes > 0) {
                status = NodeStatus.ForceRetiring
            } else if(row.availableVotes === 0 && row.unlockingVotes > 0) {
                status = NodeStatus.Retiring
            } else if(row.forfeitedVotes) {
                status = NodeStatus.Forfeited
            } else {
                status = NodeStatus.HistoricalNode
            }
            delete row['availableVotes']
            delete row['forceRetiredVotes']
            delete row['unlockingVotes']
            delete row['forfeitedVotes']
            row['status'] = status
        })

        return {count, rows}
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
        return PosAccount.findAndCountAll({
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

class AccountOverview {
    address: string // pos address
    byte32NameTagInfo: NameTag = null // name info
    createdAt: Date = null// register time
    type: string = null// Personal Node / Public Pos Pool
    status: NodeStatus = null

    availableVotesInCfx: number = 0// total voting power
    withdrawableInCfx: number = 0// withdrawable(locked vote only, withdrawable interest not included)
    lockingInCfx: number = 0// deposit freezing period
    unlockingInCfx: number = 0// unlocking
    forceRetired: number = null// the block number when the votes was retired
    totalReward: number = 0// total reward

    poolInfo: {
        address: string,
        name: string | null,
    } | null // pos pool contract info

    constructor(address: string) {
        this.address = address;
    }
}

enum NodeType {
    Personal = 'Personal Node',
    Public = 'Public Pos Pool',
}

enum NodeStatus {
    Active = 'Active',
    Retiring = 'Retiring',
    ForceRetiring = 'Force Retiring',
    Forfeited = 'Forfeited',
    HistoricalNode = 'Historical Node',
}
