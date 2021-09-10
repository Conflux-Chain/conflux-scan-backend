import {DataTypes, Model, Sequelize} from "sequelize";
import {sleep} from "../service/tool/ProcessTool";

export interface IPosBlock {
    epoch: number
    round: number
    version: number
    height: number // it's block number.
    hash: string
    parentHash: string
    timestamp: number
    minerId: number
    pivotDecision: number
    createdAt: Date
    transactionCount: number
    // signatures: []string
    signatureCount: number
}
export class PosBlock extends Model<IPosBlock> implements IPosBlock {
    epoch: number
    round: number
    version: number
    height: number // it's block number.
    hash: string
    parentHash: string
    timestamp: number
    minerId: number
    pivotDecision: number
    createdAt: Date
    transactionCount: number
    signatureCount: number
    static register(seq:Sequelize) {
        PosBlock.init({
            epoch: {type: DataTypes.BIGINT({unsigned: true})},
            round: {type: DataTypes.INTEGER, allowNull: true},
            version: {type: DataTypes.INTEGER, allowNull: true},
            height: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, primaryKey: true},
            hash: {type: DataTypes.STRING(66), allowNull: false},
            parentHash: {type: DataTypes.STRING(4), allowNull: false},
            timestamp: {type: DataTypes.BIGINT()},
            minerId: {type: DataTypes.BIGINT()},
            pivotDecision: {type: DataTypes.INTEGER()},
            createdAt: {type: DataTypes.DATE()},
            transactionCount: {type: DataTypes.INTEGER({unsigned: true})},
            signatureCount: {type: DataTypes.INTEGER({unsigned: true})},
        }, {
            tableName: 'pos_block',
            sequelize: seq,
            timestamps: false,
        })
    }
}
export interface IPosAccount {
    id: number
    hex: string
    signCount: number
    mineCount: number
    powBase32: string
}
export class PosAccount extends Model<IPosAccount> implements IPosAccount{
    id: number
    hex: string
    signCount: number
    mineCount: number
    powBase32: string // not unique
    static register(seq: Sequelize) {
        PosAccount.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), primaryKey: true},
            hex: {type: DataTypes.STRING(66), unique: true},
            signCount: {type: DataTypes.BIGINT({unsigned: true}), defaultValue: 0},
            mineCount: {type: DataTypes.BIGINT({unsigned: true}), defaultValue: 0},
            powBase32: {type: DataTypes.STRING(128)},
        }, {
            sequelize: seq,
            tableName: 'pos_account',
            timestamps: false,
            indexes: [
                {name: 'idx_pow_base32', fields:['powBase32'],}
            ]
        })
    }
    static lock = false
    static async make(hex:string, createdFn = (id)=>{}) : Promise<number>{
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
                return has.id
            }
            const max = Number(await PosAccount.max('id'))
            const next = isNaN(max) ? 1 : max + 1
            const newOne = await PosAccount.create({
                id: next, signCount: 0, mineCount: 0,
                powBase32: '',
                hex
            }).catch(err=>{
                return undefined
            })
            PosAccount.lock = false
            if (newOne) {
                createdFn(next)
                return next
            }
        } while (true)
    }
}
export interface IPosAccountBlock {
    id: number
    accountId: number
    blockNumber: number
}
export class PosAccountBlock extends Model<IPosAccountBlock> implements IPosAccountBlock {
    id: number
    accountId: number
    blockNumber: number
    static register(seq: Sequelize) {
        PosAccountBlock.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), primaryKey: true, autoIncrement: true},
            accountId: {type: DataTypes.BIGINT({unsigned: true})},
            blockNumber: {type: DataTypes.BIGINT({unsigned: true})},
        }, {
            tableName: 'pos_account_block',
            indexes: [
                {name: 'uk_acc_blk', fields: ['accountId', 'blockNumber'], unique: true}
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
    static register(seq:Sequelize) {
        PosRegister.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            // blockHash: {type: DataTypes.CHAR(4), allowNull: false},
            txHash: {type: DataTypes.CHAR(66), allowNull: false},
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
                {name: 'uk_status_change', unique: true, fields:['epoch','identifier','votePower','retire']},
                {name: 'idx_powBase32', fields:['powBase32']}
            ]
        })
    }
}

//

//
export interface IPosTransaction {
    type: number
    fromId: number
    chainId: number
    expirationTimestamp: number
    // payload
}
export interface IPosCouncil {
    totalVotingPower: number
    quorumVotingPower: number
    // committees: string[]
}
export interface PosAccount {
    addressHex: string
    addressId: number
    status: number
    startTime: Date // status start time
    votePower: number
}