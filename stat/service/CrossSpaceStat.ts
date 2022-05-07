import {CfxTransfer} from "../model/CfxTransfer";
import {Sequelize, fn, col, Op, QueryTypes, Model, DataTypes} from 'sequelize'
import {Conflux, Drip} from "js-conflux-sdk";
import {init} from "./tool/FixDailyTokenStat";
import {makeIdV} from "../model/HexMap";

export declare type CrossSpaceStat_BIZ = 'DailyCfxToEVM'
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
async function calcDailyCfxToEvm(dt: Date) {
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

async function main() {
    const cfg = await init()
    const cfx = new Conflux(cfg.conflux)
    const st = await cfx.getStatus()
    console.log(`------- ${st.chainId} ------ crossSpaceContractId ${crossSpaceContractId}`)
    const [,,cmd] = process.argv
    crossSpaceContractId = await makeIdV('0x0888000000000000000000000000000000000006')
    if (cmd === 'calcDailyCfxToEvm') {
        // node stat/dist/service/CrossSpaceStat.js calcDailyCfxToEvm
        let dt = new Date('2022-02-21')
        while(dt.getTime() < Date.now()) {
            await calcDailyCfxToEvm(dt)
            dt.setDate(dt.getDate() + 1)
        }
    }
    console.log(`done`)
    process.exit(0)
}
if (module === require.main) {
    main().then()
}