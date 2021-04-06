import {Op, Sequelize, Transaction, DataTypes, Model} from "sequelize";
import {makeId} from "./HexMap";
import {Erc721Transfer} from "./Erc721Transfer";
import {Erc777Transfer} from "./Erc777Transfer";
import {Erc1155Transfer} from "./Erc1155Transfer";
export interface ITokenTransfer {
    createdAt: Date
}
export interface IErc20Transfer extends ITokenTransfer{
    id?: number
    epoch: number
    txHashId: number
    contractId: number
    fromId: number
    toId: number
    value: number
}

export const T_ERC20_TRANSFER = "erc20transfer"

export class Erc20Transfer extends Model<IErc20Transfer> implements IErc20Transfer {
    id?: number
    epoch: number
    createdAt: Date
    contractId: number
    txHashId: number
    fromId: number
    toId: number
    value: number
    static register(seq: Sequelize) {
        Erc20Transfer.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.DECIMAL(65, 0), allowNull: false},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ERC20_TRANSFER,
            indexes: [
                {
                    name: 'idx_contract_id',
                    fields: ['contractId']
                },
                {
                    name: 'idx_epoch',
                    fields: [{name: 'epoch', order: "DESC"}]
                },
                {
                    name: 'idx_datetime',
                    fields: [{name: 'createdAt', order: "DESC"}]
                },
            ],
        })
    }
}

export async function buildErc20Transfer(obj, date) {
    const fromId = await makeId(obj.from)
    const toId = await makeId(obj.to)
    const contractId = await makeId(obj.address)
    const hashID = await makeId(obj.transactionHash);
    if (obj.tokenId !== null && obj.tokenId !== undefined && obj.value === undefined) {
        obj.value = 1
    }
    let erc20Transfer:IErc20Transfer = {
        txHashId: hashID.id,
        contractId: contractId.id,
        fromId: fromId.id,
        toId: toId.id,
        value: obj.value || 0,
        createdAt: date,
        epoch: obj.epochNumber,
    };
    return erc20Transfer
}

export async function batchSaveErc20Transfer(array: any[], seconds) {
    let templates = []
    let date = new Date(Number(seconds)*1000)
    for (const obj of array) {
        templates.push(await buildErc20Transfer(obj, date))
    }
    // console.log(`---- ${templates.map(o=>o.epoch1).join(",")}`)
    return Erc20Transfer.bulkCreate(templates, {
        // benchmark: true, logging:console.log,
    })
}

export async function batchPopErc20Transfer(epoch) {
    return Erc20Transfer.destroy({
        where: {
            epoch: epoch
        }
    })
}

export const T_DAILY_TOKEN_TXN = 'daily_token_txn'
export interface IDailyTokenTxn {
    id?:number
    txnCount:number
    day:Date
    type: string // erc20 erc721 erc777 erc1155
}
export class DailyTokenTxn extends Model<IDailyTokenTxn> implements IDailyTokenTxn{
    id?:number
    txnCount:number
    day:Date
    type: string
    static register(seq){
        DailyTokenTxn.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            txnCount: {type: DataTypes.BIGINT, allowNull: false},
            day: {type: DataTypes.DATEONLY, allowNull: false},
            type: {type: DataTypes.STRING(8), allowNull: false, unique: true},
        },{
            tableName: T_DAILY_TOKEN_TXN,
            sequelize: seq,
            indexes:[
                {name: 'idx_day_type', unique:true, fields: [{name: 'day', order: "DESC"},{name: 'type'}]}
            ]
        })
    }
}

export async function rollupDailyTokenTxn(dt:Date, model: any/*Model*/, type) {
    dt.setHours(0,0,0,0)
    let end = new Date(dt)
    end.setHours(23,59,59,999)
    let count = await model.count({        where:{
            createdAt: {[Op.between]:[dt, end]}
        }    })
    await DailyTokenTxn.upsert({
        txnCount: count, day: dt, type
    })
}

export async function rollupDailyTokenTxnCurrentAll() {
    await rollupDailyTokenTxnCurrent(Erc20Transfer, 'erc20')
    await rollupDailyTokenTxnCurrent(Erc721Transfer, 'erc721')
    await rollupDailyTokenTxnCurrent(Erc777Transfer, 'erc777')
    await rollupDailyTokenTxnCurrent(Erc1155Transfer, 'erc1155')
}
export async function rollupDailyTokenTxnCurrent(model, type) {
    const cur = new Date()
    if (cur.getHours() === 0 && cur.getMinutes() < 30) {
        // rollup previous day, time point is an hour ago.
        await rollupDailyTokenTxn(new Date(cur.getTime() - 1000*3600), model, type)
    }
    await rollupDailyTokenTxn(cur, model, type);
}

export async function scheduleRollupDailyTokenTxn() {
    await rollupDailyTokenTxnCurrentAll()
    setTimeout(scheduleRollupDailyTokenTxn, 1000*60*10)// ten minutes
}