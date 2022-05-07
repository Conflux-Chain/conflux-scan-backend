import {CfxTransfer} from "../model/CfxTransfer";
import {Sequelize, fn, col, Op, QueryTypes, Model, DataTypes} from 'sequelize'
import {Conflux, Drip} from "js-conflux-sdk";
import {init} from "./tool/FixDailyTokenStat";
import {Hex40Map, makeIdV} from "../model/HexMap";
import {FullTransaction} from "../model/FullBlock";

export declare type CrossSpaceStat_BIZ = 'DailyCfxToEVM' | 'DailyCfxFromEVM'
export interface ICrossSpaceStat {
    id?:number; day:Date; v:number; biz: CrossSpaceStat_BIZ
}
export class CrossSpaceStat extends Model<ICrossSpaceStat> implements ICrossSpaceStat {
    id?:number; day:Date; v:number; biz: CrossSpaceStat_BIZ
    static register(seq:Sequelize) {
        CrossSpaceStat.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            day: {type: DataTypes.DATEONLY},
            v: {type: DataTypes.DECIMAL(65, 18)},
            biz: {type: DataTypes.STRING(64)},
        },{
            sequelize: seq, tableName: 'cross_space_stat',
            indexes: [
                {name: 'idx_biz', fields: ['biz','day'], unique: true}
            ]
        })
    }
}
let evmZeroId = 0
export async function calcDailyCfxFromEvm(dt: Date) {
    const dayStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const dayEnd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59)
    const evm = chainId == 8888 ? 'eth8889' : 'evm'
    evmZeroId = evmZeroId || await CfxTransfer.sequelize.query(`select id from ${evm}.${Hex40Map.getTableName()
    } where hex='${'0'.padStart(40, '0')}'`, {type: QueryTypes.SELECT, raw: true,
        logging: console.log,
    }).then(res=>res[0]['id'])

    const [cfx_transfer_2, full_tx] = [CfxTransfer.getTableName(), FullTransaction.getTableName()]
    // const sql = `select x.fromId, x.toId, x.value,x.type, tx.hash, tx.gasPrice

    const sql = `select sum(x.value) as amt
    from ${evm}.${cfx_transfer_2} x left join ${evm}.${full_tx} tx 
    on tx.epoch=x.epoch and tx.blockPosition=x.blockIndex and tx.txPosition=x.txIndex
    where x.createdAt between ? and ? and tx.toId=${evmZeroId} and tx.gasPrice=0`

    const sumV = await CfxTransfer.sequelize.query(sql, {type: QueryTypes.SELECT, raw: true,
        replacements: [dayStart, dayEnd],
        logging: console.log, benchmark: true,
    }).then(res=>res[0]['amt'] || 0)

    const [bean] = await CrossSpaceStat.upsert({
        biz: "DailyCfxFromEVM", v: parseFloat(new Drip(sumV).toCFX()), day: dt,
    })
    console.log(`DailyCfxFromEVM ${dt.toISOString()} ${bean?.v}`)
}
export async function calcDailyCfxToEvm(dt: Date) {
    const dayStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const dayEnd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59)

    const sumV = await CfxTransfer.sum('value', {
        // cfx sent from cross space contract must be sent to evm space.
        where: {fromId: crossSpaceContractId, createdAt: {[Op.between]:[dayStart, dayEnd]}}
    })
    const [bean] = await CrossSpaceStat.upsert({
        biz: "DailyCfxToEVM", v: parseFloat(new Drip(sumV).toCFX()), day: dt,
    })
    console.log(`DailyCfxToEVM ${dt.toISOString()} ${bean?.v}`)
}

let crossSpaceContractId = 0
let chainId = 0
async function main() {
    const cfg = await init()
    const cfx = new Conflux(cfg.conflux)
    const st = await cfx.getStatus()
    chainId = st.chainId
    const [,,cmd] = process.argv
    crossSpaceContractId = await makeIdV('0x0888000000000000000000000000000000000006')
    console.log(`------- net ${st.chainId} ------ crossSpaceContractId ${crossSpaceContractId}`)
    if (cmd === 'calcDailyCfxToEvm') {
        // node stat/dist/service/CrossSpaceStat.js calcDailyCfxToEvm
        let dt = new Date('2022-02-21')
        while(dt.getTime() < Date.now()) {
            await calcDailyCfxToEvm(dt)
            dt.setDate(dt.getDate() + 1)
        }
    } else if (cmd === 'calcDailyCfxFromEvm') {
        // node stat/dist/service/CrossSpaceStat.js calcDailyCfxFromEvm
        let dt = new Date('2022-02-21')
        while(dt.getTime() < Date.now()) {
            await calcDailyCfxFromEvm(dt)
            dt.setDate(dt.getDate() + 1)
        }
    } else {
        console.log(`unknown command [${cmd}]`)
    }
    console.log(`done`)
    process.exit(0)
}
if (module === require.main) {
    main().then()
}