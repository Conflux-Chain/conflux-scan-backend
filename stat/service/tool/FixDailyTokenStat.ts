import {calcDailyActiveAddress, DailyActiveAddress} from "../../model/StatAddress";

import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {
    calcAllRegisteredTokenDailyStat,
    calcDailyToken,
    calcDailyTokenAmount,
    calcDailyTokenParticipants,
    DailyTxnSync
} from "../DailyTxnSync";
import {Op, Sequelize, Options} from "sequelize"
import {Token} from "../../model/Token";
import {BalanceWatcher} from "../watcher/BalanceWatcher";
import {RankService} from "../RankService";
import {ContractService} from "../contract/ContractService";
import {Balance_K} from "../../model/Balance";
import {redisWrap, RedisWrap, TRANSFER_ADDRESS_Q, xLen} from "../RedisWrap";
export async function init() {
    const config = loadConfig('Prod')
    // let seq = new Sequelize(config.databaseRW.instanceName, null, null, config.databaseRW as Options);//createDB(config.database)
    let seq = new Sequelize(config.database)
    await initModel(seq)
    await seq.sync({})
    return config
}
export async function fixDate(hexId=0) {
    let dt = new Date('2020-10-28')
    let now = new Date()
    while( dt < now) {
        if (hexId) {
            await calcDailyToken(dt, hexId)
        } else {
            await calcAllRegisteredTokenDailyStat(dt)
        }
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
    const tokenList = await Token.findAll()
    let dt = new Date('2021-07-01')
    let now = new Date()
    while( dt < now) {
        let start = new Date(dt); start.setUTCHours(0,0,0,0)
        let end = new Date(dt);   end.setUTCHours(23,59,59,999)
        for (const token of tokenList) {
            const model = BalanceWatcher.mapModel(token.symbol, true);
            if (model) {
                await calcDailyTokenParticipants(token.hex40id, token.type, start, end)
            }
        }
        dt.setDate(dt.getDate()+1)
    }
    console.log(`done.`)
}

async function testRank() {
    new ContractService('',1)
    const svc = new RankService({tokenQuery:{list:()=>undefined}, tokenTool:{getToken:()=>{return {}}}})
    await svc.rankByToken('daily_token','uniqueReceiver', 1, 10, 1029);
    await svc.rankByToken('daily_token','uniqueSender', 1, 10, 1029);
    await svc.rankByToken('daily_token','participants', 1, 10, 1029);
    await svc.rankByToken('daily_token','transferCount', 1, 10, 1029);
}
async function checkTokenHolderTop(token: Token) {
    const model = BalanceWatcher.mapModel(token.symbol, true)
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
if (require.main === module) {
    const args = process.argv.slice(2)
    init().then((cfg)=> {
        return RedisWrap.connect(cfg.redis)
    }).then(()=>{
        if (args[0] === 'participants') {
            // node stat/dist/service/tool/ participants
            return fixParticipants()
        } else if (args[0] === 'topTokens') {
            return checkAllTokenHolderTop()
        } else if (args[0] === 'test') {
            return testRank()
        } else if (args[0] === 'amount') {
            if (args.length === 3) {
                // node this amount 2021-05-13 1
                return calcDailyTokenAmount(new Date(args[1]), Number(args[2]))
            } else {
                // node this amount 1
                return fixDateAmount(Number(args[1]));
            }
        } else if (args.length === 1) {
            // node this 123
            return fixDate(Number(args[0]))
        } else if (args[0]) {
            // node this '2021-04-29' 123
            return calcDailyToken(new Date(args[0]), Number(args[1]))
        } else {
            return fixDate()
        }
    }).then(()=>{
        redisWrap.client.end(false)
        DailyActiveAddress.sequelize.close().then()
    })
}