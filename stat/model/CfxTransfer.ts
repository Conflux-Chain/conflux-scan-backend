import {Op, Sequelize, Transaction, DataTypes, Model, fn} from "sequelize";
import {makeId} from "./HexMap";
import {TransactionDB} from "./Transaction";

export interface ICfxTransfer {
    id?: number
    epoch: number
    createdAt: Date
    txHashId: number
    fromId: number
    toId: number
    value: number
}
export const T_CFX_TRANSFER = 'cfx_transfer'
export class CfxTransfer extends Model<ICfxTransfer> implements ICfxTransfer {
    id?: number
    epoch: number
    createdAt: Date
    txHashId: number
    fromId: number
    toId: number
    value: number
    static register(seq) {
        CfxTransfer.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.DECIMAL(36, 0), allowNull: false},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_CFX_TRANSFER,
            indexes: [
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

export async function buildCfxTransfer(obj, date) {
    const fromId = await makeId(obj.from, undefined, {dt:date})
    const toId = await makeId(obj.to, undefined, {dt:date})
    const hashID = await makeId(obj.transactionHash);
    let cfxTransfer:ICfxTransfer = {
        txHashId: hashID.id,
        fromId: fromId.id,
        toId: toId.id,
        value: obj.value || 0,
        createdAt: date,
        epoch: obj.epochNumber,
    };
    return cfxTransfer
}


export async function batchSaveCfxTransfer(array: any[], seconds) {
    let templates = []
    let date = new Date(Number(seconds)*1000)
    for (const obj of array) {
        templates.push(await buildCfxTransfer(obj, date))
    }
    // console.log(`batchSaveCfxTransfer ---- ${array.length}`)
    return CfxTransfer.bulkCreate(templates, {
        // benchmark: true, logging:console.log,
    })
}

export async function batchPopCfxTransfer(epoch) {
    return CfxTransfer.destroy({
        where: {
            epoch: epoch
        }
    })
}

export const T_DAILY_CFX_TXN = 'daily_cfx_txn'
export interface IDailyCfxTxn {
    id?:number
    txnCount:number
    day:Date
}
export class DailyCfxTxn extends Model<IDailyCfxTxn> implements IDailyCfxTxn{
    id?:number
    txnCount:number
    day:Date
    static register(seq){
        DailyCfxTxn.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            txnCount: {type: DataTypes.BIGINT, allowNull: false},
            day: {type: DataTypes.DATEONLY, allowNull: false, unique: true},
        },{
            tableName: T_DAILY_CFX_TXN,
            sequelize: seq,
            indexes:[
                {name: 'idx_day', fields: [{name: 'day', order: "DESC"}]}
            ]
        })
    }
}

export async function rollupDailyCfxTxn(dt:Date) {
    dt.setHours(0,0,0,0)
    let end = new Date(dt)
    end.setHours(23,59,59,999)
    let count = await CfxTransfer.count({        where:{
            createdAt: {[Op.between]:[dt, end]}
        }    })
    await DailyCfxTxn.upsert({
        txnCount: count, day: dt
    })
}

export async function rollupDailyCfxTxnCurrent() {
    const cur = new Date()
    if (cur.getHours() === 0 && cur.getMinutes() < 30) {
        // rollup previous day, time point is an hour ago.
        await rollupDailyCfxTxn(new Date(cur.getTime() - 1000*3600))
    }
    await rollupDailyCfxTxn(cur);
}

export async function scheduleRollupDailyCfxTxn() {
    await rollupDailyCfxTxnCurrent()
    setTimeout(scheduleRollupDailyCfxTxn, 1000*60*10)// ten minutes
}

export async function sumRecentCfxTxn(days:number) : Promise<number> {
    return DailyCfxTxn.findAll({limit:days, order:[['day','desc']]})
        .then(arr=>arr.map(row=>row.txnCount).reduce((a,b)=>a+b))
}

export async function sumRecentCfxAmount(days:number) : Promise<BigInt> {
    // select sum(`value`) from cfx_transfer where createdAt > addtime(now(), '-7 0:0:0');
    // select createdAt ,`fromId`,`value`,txHashId from cfx_transfer where createdAt > addtime(now(), '-7 0:0:0') order by `value` desc limit 10;
    // select sum(`value`) from tx where blockTime > addtime(now(), '-7 0:0:0') and status=0;
    return TransactionDB.sum('value',{
        where: { 'blockTime': {[Op.gt]: fn('addtime', fn('now'), `${days} 0:0:0`), status: 0}},
        // benchmark: true, logging: console.log
    }).then(BigInt)
}
