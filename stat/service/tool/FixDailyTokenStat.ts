process.env.TZ = 'UTC'

import {calcDailyActiveAddress, DailyActiveAddress} from "../../model/StatAddress";
import {getYesterday} from "./DateTool";

import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {
    calcAllRegisteredTokenDailyStat,
    calcDailyToken,
    calcDailyTokenAmount,
    DailyTxnSync
} from "../DailyTxnSync";
import {Op, Sequelize, Options} from "sequelize"
import {Token} from "../../model/Token";
import {BalanceWatcher} from "../watcher/BalanceWatcher";
import {RankService} from "../RankService";
import {ContractService} from "../contract/ContractService";
import {Balance_K} from "../../model/Balance";
import {redisWrap, RedisWrap, TRANSFER_ADDRESS_Q, xLen} from "../RedisWrap";
import {calcDailyTokenOnChain, calcOneDayUniqueArr} from "../UniqueAddressStat";
export async function init() {
    const config = loadConfig('Prod')
    // let seq = new Sequelize(config.databaseRW.instanceName, null, null, config.databaseRW as Options);//createDB(config.database)
    let seq = createDB(config.databaseRW)
    await initModel(seq)
    await seq.sync({})
    return config
}
export async function fixDate(hexId=0, dtStr = '2020-10-28') {
    let dt = new Date(dtStr)
    let now = new Date()
    while( dt < now) {
        if (hexId) {
            await calcDailyToken(dt, hexId)
        } else {
            await calcAllRegisteredTokenDailyStat(dt)
        }
        console.log(`fixed ${dt.toISOString()}`)
        dt.setDate(dt.getDate()+1)
    }
    console.log(`done.`)
}
async function fixDateAmount(hexId=0) {
    let dt = new Date('2020-10-28')
    let now = new Date()
    while( dt < now) {
        if (hexId) {
            await calcDailyTokenAmount(dt, hexId)
        } else {
            const tokenList = await Token.findAll()
            for(const token of tokenList) {
                if (token.type.includes('20') || token.type.includes('777')) {
                    await calcDailyTokenAmount(dt, token.hex40id)
                }
            }
        }
        dt.setDate(dt.getDate()+1)
    }
    console.log(`done.`)
}

// alter table daily_token add column participants bigint unsigned not null default 0;
async function fixParticipants() {
    let dt = new Date('2021-12-16')
    let now = new Date()
    while( dt < now) {
        let start = new Date(dt);
        await calcOneDayUniqueArr(start)
        dt.setDate(dt.getDate()+1)
    }
    console.log(`done.`)
}

async function testRank() {
    new ContractService('',1)
    const svc = new RankService({tokenQuery:{list:()=>undefined}, tokenTool:{getToken:()=>{return {}}}})
    await svc.rankByToken('daily_token','transferCount', 1, 10, 1029);
}
async function checkTokenHolderTop(token: Token) {
    const model = BalanceWatcher.mapModel('', true, token.hex40id)
    if (!model) {
        return;
    }
    const now = new Date()
    now.setDate(now.getDate()-1)
    const list = await model.findAll({order:[['balance','desc']], limit: 20, raw:true})
    const arr = []
    list.forEach(b=>{
        const upAt:Date = b['updatedAt']
        if (upAt.getTime() < now.getTime()) {
            arr.push(b.addressId)
        }
    })
    if (arr.length) {
        await RedisWrap.sendStreamMessage(arr, TRANSFER_ADDRESS_Q)
        console.log(`want update address ${arr.length} for token ${token.symbol} ${token.name} ${model.getTableName()} ${token.base32}`)
    } else {
        console.log(`nothing to update, token ${model.getTableName()}, top count ${list.length}`)
    }
}

async function checkAllTokenHolderTop() {
    const len1 = await xLen(TRANSFER_ADDRESS_Q)
    const all = await Token.findAll({where: {symbol:{[Op.ne]:null}, fetchBalance: true}})
    for (const token of all) {
        await checkTokenHolderTop(token)
    }
    const len2 = await xLen(TRANSFER_ADDRESS_Q)
    console.log(`transfer q len1 ${len1} len2 ${len2}`)
}

async function syncDailyTxCntr(dt){
    const statDay = getYesterday(dt);
    return new DailyTxnSync().countDaily(statDay);
}
async function dailyTokenTxn() {
    const [,,cmd,dt] = process.argv;
    await calcDailyTokenOnChain(new Date(dt)).then(()=>{
        console.log(`ok.`)
        process.exit(0)
    })
}
if (require.main === module) {
    main().then()
}
async function main() {
    const [,,cmd,arg1,arg2] = process.argv
    init().then((cfg)=> {
        return RedisWrap.connect(cfg.redis)
    }).then(async ()=>{
        if (cmd === 'participants') {
            // node stat/dist/service/tool/ participants
            return fixParticipants()
        } else if (cmd === 'topTokens') {
            return checkAllTokenHolderTop()
        } else if (cmd === 'dailyTokenTxn') {
            return dailyTokenTxn()
        } else if (cmd === 'test') {
            return testRank()
        } else if (cmd === 'dailyTx') {
            return syncDailyTxCntr(arg1);
        } else if (cmd === 'amount-dt-hex') {
            const[,,cmd,dt,hex] = process.argv
            return calcDailyTokenAmount(new Date(dt), Number(hex))
        } else if (cmd === 'amount') {
            return fixDateAmount(Number(arg1));
        } else if (cmd === 'fix-date') {
            // node this 123
            return fixDate(Number(arg1))
        } else if (cmd === 'fix-dt-hex') {
            // node this '2021-04-29' 123
            return calcDailyToken(new Date(arg1), Number(arg2))
        } else if (cmd ==='fix-dt'){
            await fixDate(0, arg1)
        }
    }).then(()=>{
        redisWrap.client.end(false)
        DailyActiveAddress.sequelize.close().then()
    })
}