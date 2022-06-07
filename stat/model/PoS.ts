import {DataTypes, Model, Sequelize, fn, col, Op} from "sequelize";
import {sleep} from "../service/tool/ProcessTool";
export interface IPosGap {
    height: number // it's block number.
    powEpoch: number; epochGap: number; secondsGap:number, createdAt: Date;
}
export class PosGap extends Model<IPosGap> implements IPosGap {
    height: number // it's block number.
    powEpoch: number; epochGap: number; secondsGap:number;createdAt: Date;
    static register(seq: Sequelize) {
        PosGap.init({
            height: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, primaryKey: true},
            powEpoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            epochGap: {type: DataTypes.INTEGER({unsigned: true}), allowNull: false},
            secondsGap: {type: DataTypes.INTEGER({unsigned: true}), allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            sequelize: seq, tableName: 'pos_gap', updatedAt: false
        })
    }
}
//
export interface IPosBlock {
    epoch: number
    round: number
    height: number // it's block number.
    hash: string
    parentHash: string
    timestamp: number
    minerId: number
    pivotDecision: number
    createdAt: Date
    nextTxNumber:number // lastTxNumber in fact.
    transactionCount: number
    // signatures: []string
    signatureCount: number
}
export class PosBlock extends Model<IPosBlock> implements IPosBlock {
    epoch: number
    round: number
    height: number // it's block number.
    hash: string
    parentHash: string
    timestamp: number
    minerId: number
    pivotDecision: number
    createdAt: Date
    nextTxNumber:number // lastTxNumber in fact.
    transactionCount: number
    signatureCount: number
    static register(seq:Sequelize) {
        PosBlock.init({
            epoch: {type: DataTypes.BIGINT({unsigned: true})},
            round: {type: DataTypes.INTEGER, allowNull: true},
            height: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, primaryKey: true},
            hash: {type: DataTypes.STRING(66), allowNull: false},
            parentHash: {type: DataTypes.STRING(4), allowNull: false},
            timestamp: {type: DataTypes.BIGINT()},
            minerId: {type: DataTypes.BIGINT()},
            pivotDecision: {type: DataTypes.INTEGER()},
            createdAt: {type: DataTypes.DATE()},
            transactionCount: {type: DataTypes.INTEGER({unsigned: true})},
            nextTxNumber: {type: DataTypes.INTEGER({unsigned: true})},
            signatureCount: {type: DataTypes.INTEGER({unsigned: true})},
        }, {
            tableName: 'pos_block',
            sequelize: seq,
            timestamps: false,
            indexes: [{
                name:'idx_date', fields: ['createdAt']
            }]
        })
    }
}
export interface IPosAccount {
    id: number
    hex: string
    signCount: number
    mineCount: number
    powBase32: string
    totalReward: number
    availableVotes: number
    lockedVotes: number
    unlockedVotes: number
    forfeitedVotes: number
    forceRetiredVotes: number
    createdAt?: Date
    updatedAt?: Date
}
export class PosAccount extends Model<IPosAccount> implements IPosAccount{
    id: number
    hex: string
    signCount: number
    mineCount: number
    powBase32: string // not unique
    totalReward: number
    availableVotes: number
    lockedVotes: number
    unlockedVotes: number
    forfeitedVotes: number
    forceRetiredVotes: number
    createdAt?: Date
    updatedAt?: Date
    static register(seq: Sequelize) {
        PosAccount.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), primaryKey: true},
            hex: {type: DataTypes.STRING(66), unique: true},
            signCount: {type: DataTypes.BIGINT({unsigned: true}), allowNull:false, defaultValue: 0},
            mineCount: {type: DataTypes.BIGINT({unsigned: true}), allowNull:false, defaultValue: 0},
            powBase32: {type: DataTypes.STRING(128)},
            totalReward: {type: DataTypes.DECIMAL(56, 0), allowNull:false, defaultValue: 0},
            availableVotes: {type: DataTypes.BIGINT({unsigned: true}), allowNull:false, defaultValue: 0},
            lockedVotes: {type: DataTypes.BIGINT({unsigned: true}), allowNull:false, defaultValue: 0},
            unlockedVotes: {type: DataTypes.BIGINT({unsigned: true}), allowNull:false, defaultValue: 0},
            forfeitedVotes: {type: DataTypes.BIGINT({unsigned: true}), allowNull:false, defaultValue: 0},
            forceRetiredVotes: {type: DataTypes.BIGINT({unsigned: true}), allowNull:false, defaultValue: 0},
        }, {
            sequelize: seq,
            tableName: 'pos_account',
            timestamps: true,
            indexes: [
                {name: 'idx_pow_base32', fields:['powBase32'],},
                //{name: 'idx_pos_hex', fields:['hex'], unique: true},// field has unique modifier.
            ]
        })
    }
    static lock = false
    static printLog = false
    static async make(hex:string, dt:Date, createdFn = (id)=>{}) : Promise<number>{
        // TODO use some cache.
        do {
            if (PosAccount.lock) {
                await sleep(1)
                continue
            }
            PosAccount.lock = true
            const has = await PosAccount.findOne({where: {hex}})
            if (has) {
                PosAccount.lock = false
                PosAccount.printLog && console.log(` account exists: ${has.id}`)
                return has.id
            }
            const max = Number(await PosAccount.max('id'))
            const next = isNaN(max) ? 1 : max + 1
            const newOne = await PosAccount.create({
                id: next, signCount: 0, mineCount: 0,
                powBase32: '',
                hex, totalReward: 0, availableVotes: 0, forceRetiredVotes: 0,
                forfeitedVotes: 0,
                lockedVotes: 0,
                unlockedVotes: 0,
                createdAt: dt,
            }).catch(err=>{
                return undefined
            })
            PosAccount.lock = false
            if (newOne) {
                PosAccount.printLog && console.log(` account created: ${next}`)
                createdFn(next)
                return next
            }
        } while (true)
    }
}
// record the corresponding pow epoch of each pow reward event.
export interface IPosEpochRewardHash {
    epoch:number
    powDate:Date
    powEpochHash:string
    powEpoch:number
    drip: bigint
}
export class PosEpochRewardHash extends Model<IPosEpochRewardHash> implements IPosEpochRewardHash {
    epoch:number
    powEpochHash:string
    powDate:Date
    powEpoch: number
    drip: bigint
    static register(seq: Sequelize) {
        PosEpochRewardHash.init({
            epoch: {type: DataTypes.BIGINT({unsigned: true}), primaryKey: true},
            powEpochHash: {type: DataTypes.STRING(66)},
            powDate: {type: DataTypes.DATE},
            powEpoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            drip: {type: DataTypes.DECIMAL(56, 0), allowNull: false},
        }, {
            sequelize: seq, tableName: 'pos_epoch_reward_hash',
        })
    }
}

export interface IPosReward {
    id?:number
    accountId:number
    epoch:number
    reward:number
    createdAt:Date
}
export class PosReward extends Model<IPosReward> implements IPosReward {
    id?:number
    accountId:number
    epoch:number
    reward:number
    createdAt:Date
    static register(seq:Sequelize) {
        PosReward.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            accountId: {type: DataTypes.BIGINT({unsigned: true})},
            reward: {type: DataTypes.DECIMAL(36, 0)},
            createdAt: {type: DataTypes.DATE()},
            epoch: {type: DataTypes.BIGINT({unsigned: true})},
        }, {
            sequelize: seq,
            tableName: 'pos_reward',
            timestamps: false,
            indexes: [
                {name: 'idx_accountId_epoch', fields:['accountId', 'epoch'], unique: true},
            ]
        })
    }
}
export async function recentPosRewardRank(afterTime: Date, limit = 10) {
    let debug = false;
    return PosReward.findAll({
        attributes: [
            [fn('sum', col('reward')), 'reward'],
            'accountId',
        ],
        where: {createdAt: {[Op.gte]: afterTime}},
        group: ['accountId'], order: [[col('reward'), 'desc']], limit, raw: true,
        logging: debug ? console.log : false,
    })
}
export interface IPosAccountBlock {
    id: number
    accountId: number
    blockNumber: number
    votes: number
}
// It's signed blocks by an account. not mined.
export class PosAccountBlock extends Model<IPosAccountBlock> implements IPosAccountBlock {
    id: number
    accountId: number
    blockNumber: number
    votes: number
    static register(seq: Sequelize) {
        PosAccountBlock.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), primaryKey: true, autoIncrement: true},
            accountId: {type: DataTypes.BIGINT({unsigned: true})},
            blockNumber: {type: DataTypes.BIGINT({unsigned: true})},
            votes: {type: DataTypes.BIGINT({unsigned: true})},
        }, {
            tableName: 'pos_account_block',
            indexes: [
                {name: 'uk_acc_blk', fields: ['accountId', 'blockNumber'], unique: true},
                {name: 'idx_blk', fields: ['blockNumber']},
            ],
            sequelize: seq,
            timestamps: false
        })
    }
}
export interface IPosRegister {
    id?: number,
    epoch: number
    // blockHash: string
    txHash: string
    // txIdx: number
    // logIdx: number
    powBase32: string
    // createdAt: Date
    //
    identifier: string
    votePower?: number // uint64 , when increasing stake
    blsPubKey?: string
    vrfPubKey?: string
    retire?: boolean
    transactionLogIndex:number
}
export class PosRegister extends Model<IPosRegister> implements IPosRegister {
    id?: number
    epoch: number
    // blockHash: string
    txHash: string
    // txIdx: number
    // logIdx: number
    powBase32: string
    // createdAt: Date
    //
    identifier: string
    votePower?: number // uint64 , when increasing stake

    blsPubKey?: string // when creating
    vrfPubKey?: string // when creating
    retire?: boolean // when retiring
    transactionLogIndex:number
    static register(seq:Sequelize) {
        PosRegister.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            // blockHash: {type: DataTypes.CHAR(4), allowNull: false},
            txHash: {type: DataTypes.CHAR(66), allowNull: false},
            transactionLogIndex: {type: DataTypes.INTEGER, allowNull: false},
            // txIdx: {type: DataTypes.INTEGER, allowNull: false},
            // logIdx: {type: DataTypes.INTEGER, allowNull: false},
            powBase32: {type: DataTypes.STRING(128), allowNull: true, defaultValue: ''},
            // createdAt: {type: DataTypes.DATE, allowNull: false},
            identifier: {type: DataTypes.STRING(128), allowNull: false},
            votePower: {type: DataTypes.DECIMAL(64,0), allowNull: false, defaultValue: 0},

            blsPubKey: {type: DataTypes.STRING(128), allowNull: false, defaultValue: ''},
            vrfPubKey: {type: DataTypes.STRING(128), allowNull: false, defaultValue: ''},
            retire: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
        }, {
            sequelize: seq, tableName: 'pos_register',
            timestamps: false,
            indexes: [
                // {name: 'idx_epoch', fields:['epoch']},
                //
                {name: 'uk_epoch_tx_log_idx', unique: true, fields:['epoch','txHash','transactionLogIndex']},
                {name: 'idx_powBase32', fields:['powBase32']},
            ]
        })
    }
}

//

//
export interface IPosTransaction {
    number: number, // it's pk.
    blockNumber: number,
    hash: string
    fromId: number
    type: string
    status: string
    createdAt: Date
    // payload
}
export class PosTransaction extends Model<IPosTransaction> implements IPosTransaction {
    number: number // it's pk.
    hash: string
    blockNumber: number
    fromId: number
    type: string
    status: string
    createdAt: Date
    static register(seq:Sequelize) {
        PosTransaction.init({
            number: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            blockNumber: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, defaultValue: 0},
            fromId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, defaultValue: 0},
            type: {type: DataTypes.CHAR({length: 32}), allowNull: false, defaultValue: ''},
            hash: {type: DataTypes.CHAR({length: 66}), allowNull: false, defaultValue: ''},
            status: {type: DataTypes.CHAR({length: 32}), allowNull: false, defaultValue: ''},
            createdAt: {type: DataTypes.DATE(), allowNull: false},
        }, {
            sequelize: seq,
            tableName: 'pos_tx',
            timestamps: false,
            indexes: [
                {name: 'idx_block', fields: ['blockNumber']}
            ]
        })
    }
}
export interface IPosCommittee {
    id?: number
    epochNumber: number
    blockNumber: number
    totalVotingPower: number
    quorumVotingPower: number
    nodesCount: number
    // committees: string[]
}
export class PosCommittee extends Model<IPosCommittee> implements IPosCommittee{
    blockNumber: number // primary key
    epochNumber: number
    totalVotingPower: number
    quorumVotingPower: number
    nodesCount: number
    static register(seq:Sequelize) {
        PosCommittee.init({
            blockNumber: {type: DataTypes.BIGINT({unsigned: true}), primaryKey: true},
            epochNumber: {type: DataTypes.BIGINT({unsigned: true}), },
            totalVotingPower: {type: DataTypes.BIGINT({unsigned: true}), },
            quorumVotingPower: {type: DataTypes.BIGINT({unsigned: true}), },
            nodesCount: {type: DataTypes.INTEGER({unsigned: true}), allowNull: false},
        }, {
            sequelize: seq,
            tableName: 'pos_committee',
            updatedAt: false,
        })
    }
}
export interface IPosCommitteeNode {
    id?: number
    epochNumber: number
    blockNumber: number
    accountId: number
    votingPower: number
}
export class PosCommitteeNode extends Model<IPosCommitteeNode> implements IPosCommitteeNode {
    id?: number
    epochNumber: number
    blockNumber: number
    accountId: number
    votingPower: number
    static register(seq:Sequelize) {
        PosCommitteeNode.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            accountId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            epochNumber: {type: DataTypes.BIGINT({unsigned: true}), },
            blockNumber: {type: DataTypes.BIGINT({unsigned: true}), },
            votingPower: {type: DataTypes.BIGINT({unsigned: true}), },
        }, {
            sequelize: seq,
            tableName: 'pos_committee_node',
            indexes: [{
                name: 'idx_accountId', fields: ['accountId']
            }, {
                name: 'idx_block_n', fields: ['blockNumber']
            }],
            updatedAt: false,
        })
    }
}
//
export interface IPosDailyStat {
    id?:number
    epoch:number
    createdAt: Date
    updatedAt: Date
    stakingAmount: number
    lockedVotes: number
    statDay: Date
}
export class PosDailyStat extends Model<IPosDailyStat> implements IPosDailyStat{
    id?:number
    epoch:number
    createdAt: Date
    updatedAt: Date
    stakingAmount: number
    lockedVotes: number
    statDay: Date
    static register(seq:Sequelize) {
        PosDailyStat.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            createdAt: {type: DataTypes.DATE, },
            updatedAt: {type: DataTypes.DATE, },
            stakingAmount: {type: DataTypes.DECIMAL(56,0), allowNull: false},
            lockedVotes: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            statDay: {type: DataTypes.DATEONLY, },
        },{
            sequelize: seq, tableName: 'pos_daily_stat',
            indexes: [
                {name: 'uk_stat_day', fields: ['statDay']}
            ]
        })
    }
}