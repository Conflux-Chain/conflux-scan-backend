import {CfxTransfer} from "../model/CfxTransfer";
import {Sequelize, Op, QueryTypes, Model, DataTypes, literal} from 'sequelize'
import {Conflux, Drip} from "js-conflux-sdk";
import {init} from "./tool/FixDailyTokenStat";
import {Hex40Map, makeIdV} from "../model/HexMap";
import {FullTransaction} from "../model/FullBlock";
import {IS_EVM2, KV} from "../model/KV";
import {initCfxSdk} from "./common/utils";
import {EvmDB} from "../config/StatConfig";
import {findCfxSyncMaxDate} from "./tool/CfxTransferTool";
import {patchDateOnlyField} from "../model/Utils";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";

export declare type CrossSpaceStat_BIZ = 'DailyCfxToEVM' | 'DailyCfxFromEVM'
    | 'DailyCfxCountToEVM' | 'DailyCfxCountFromEVM'
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
export async function queryCrossSpaceStat(biz1: CrossSpaceStat_BIZ, biz2: CrossSpaceStat_BIZ,
                                          biz3: CrossSpaceStat_BIZ, biz4: CrossSpaceStat_BIZ,
                                          ctx:any) {
    const t = CrossSpaceStat.getTableName()
    const sql = `select day, v  from ${t} where biz='${biz1}'`
    const sql2 = `select day, v from ${t} where biz='${biz2}'`
    const sql3 = `select day, v from ${t} where biz='${biz3}'`
    const sql4 = `select day, v from ${t} where biz='${biz4}'`
    const join = `select t.day, t.v as ${biz1}, t2.v as ${biz2}, t3.v as ${biz3}, t4.v as ${biz4
    } from (${sql}) t join (${sql2}) t2 on t.day = t2.day join (${sql3}) t3  on t.day = t3.day join (${sql4}) t4  on t.day = t4.day `
    const list = await CrossSpaceStat.sequelize.query(join, {
        type: QueryTypes.SELECT, raw: true
    })
    ctx.body = { /*code: 0,*/ total:list.length, list }
    return list;
}
let evmZeroId = 0
export async function calcDailyCfxFromEvm(dt: Date) {
    const dayStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const dayEnd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59)
    const evm = EvmDB;
    evmZeroId = evmZeroId || await CfxTransfer.sequelize.query(`select id from ${evm}.${Hex40Map.getTableName()
    } where hex='${'0'.padStart(40, '0')}'`, {type: QueryTypes.SELECT, raw: true,
        // logging: console.log,
    }).then(res=>res[0]['id'])

    const [cfx_transfer_2, full_tx] = [CfxTransfer.getTableName(), FullTransaction.getTableName()]
    // const sql = `select x.fromId, x.toId, x.value,x.type, tx.hash, tx.gasPrice

    const sql = `select sum(x.value) as amt, count(*) as cnt
    from ${evm}.${cfx_transfer_2} x left join ${evm}.${full_tx} tx 
    on tx.epoch=x.epoch and tx.blockPosition=x.blockIndex and tx.txPosition=x.txIndex
    where x.createdAt between ? and ? and tx.toId=${evmZeroId} and tx.gasPrice=0`

    const [sumV, cnt] = await CfxTransfer.sequelize.query(sql, {type: QueryTypes.SELECT, raw: true,
        replacements: [dayStart, dayEnd],
        // logging: console.log, benchmark: true,
    }).then(res=>{
        return [res[0]['amt'] || 0, res[0]['cnt'] || 0]
    })

    const [bean] = await CrossSpaceStat.upsert({
        biz: "DailyCfxFromEVM", v: parseFloat(new Drip(sumV||0).toCFX()), day: dt,
    })
    await CrossSpaceStat.upsert({
        biz: "DailyCfxCountFromEVM", v: cnt, day: dt,
    })
    console.log(`DailyCfxFromEVM ${dt.toISOString()} ${bean?.v}`)
}
export async function calcDailyCfxToEvm(dt: Date) {
    const dayStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const dayEnd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59)

    const {value:sumV, epoch: count} = await CfxTransfer.findOne({
        attributes: [
            [literal("sum(`value`)"), 'value'],
            [literal(`count(*)`), 'epoch'],
        ],
        // cfx sent from cross space contract must be sent to evm space.
        where: {fromId: crossSpaceContractId, createdAt: {[Op.between]:[dayStart, dayEnd]}},
        raw: true,
    })
    const [bean] = await CrossSpaceStat.upsert({
        biz: "DailyCfxToEVM", v: parseFloat(new Drip(sumV||0).toCFX()), day: dt,
    })
    await CrossSpaceStat.upsert({
        biz: "DailyCfxCountToEVM", v: count, day: dt,
    })
    console.log(`DailyCfxToEVM ${dt.toISOString()} ${bean?.v}`)
}
export async function listCrossSpaceStat(biz: CrossSpaceStat_BIZ, receiver: any=undefined) {
    const list = await CrossSpaceStat.findAll({where: {biz}, order: [['day', 'asc']]})
    if(receiver){
        receiver.body = {code: 0, list, total: list.length}
    }
    return list;
}
let crossSpaceContractId = 0
let chainId = 0
async function setup(cfx:Conflux) {
    const st = await cfx.getStatus()
    chainId = st.chainId
    crossSpaceContractId = await makeIdV('0x0888000000000000000000000000000000000006')
    console.log(`------- net ${st.chainId} ------ crossSpaceContractId ${crossSpaceContractId}`)
}
export async function scheduleCrossSpaceStat(cfx:Conflux) {
    await setup(cfx)
    const isEvm = await KV.getSwitch(IS_EVM2)
    if (isEvm) {
        return;
    }
    setInterval(()=>{
        checkLatestToEvm().catch(e=>{
            safeAddErrorLog('token-x',`check-latest-to-evm`, e);
            const str = `${e}`;
            if (str.includes('Unknown database')) {
                console.log(`evm db not exist ${EvmDB}`)
            } else {
                console.log(`${__filename} cfx from evm error:`, e)
            }
        })
    }, 600_000);
}

async function checkLatestToEvm() {
    let latest = await CrossSpaceStat.findOne({order: [['day','asc']], raw: true})
    patchDateOnlyField(latest);
    let dt = latest?.day || new Date('2022-02-20')
    const cfxSyncMaxDate = await findCfxSyncMaxDate();
    if (!cfxSyncMaxDate) {
        return;
    }
    const syncMaxMs = cfxSyncMaxDate.getTime();
    while (dt.getTime() < syncMaxMs) {
        await calcDailyCfxToEvm(dt)
        await calcDailyCfxFromEvm(dt)
        dt.setDate(dt.getDate() + 1)
    }
}

async function main() {
    const config = await init()
    const cfx = await initCfxSdk(config.conflux);
    await setup(cfx)
    const [,,cmd] = process.argv
    if (cmd === 'checkLatestToEvm') {
        // node stat/service/CrossSpaceStat.js checkLatestToEvm
        await checkLatestToEvm();
    } else {
        console.log(`unknown command [${cmd}]`)
    }
    console.log(`done`)
    process.exit(0)
}
if (module === require.main) {
    main().then()
}
