import { col, fn, Op} from 'sequelize'
import {DailyTokenTxn, Erc20Transfer, T_ERC20_TRANSFER} from "../model/Erc20Transfer";
import {DailyToken, Token} from "../model/Token";
import {Erc721Transfer, T_ERC721_TRANSFER} from "../model/Erc721Transfer";
import {Erc1155Transfer, T_ERC1155_TRANSFER} from "../model/Erc1155Transfer";
import {QueryTypes} from "sequelize";
import {BalanceWatcher} from "./watcher/BalanceWatcher";
import {adjustTodayEndTime, getEpochRange} from "../model/Utils";

let showDebugLog = true
export async  function scheduleDailyTokenStat() {
    showDebugLog = false
    await calcAllRegisteredTokenDailyStat(new Date()).catch(e=>{
        console.log(`failed to calcAllRegisteredTokenDailyStat`, e)
    })
    setTimeout(scheduleDailyTokenStat, 1000*3600*4) //
}
export async  function calcAllRegisteredTokenDailyStat(dt:Date) {
    const tokenList = await Token.findAll({
        attributes: ['hex40id','symbol','name','base32'],
        where: {auditResult: true},
    })
    console.log(`${new Date().toISOString()} begin calculate token's daily statistics:`)
    for(const token of tokenList) {
        await calcDailyToken(dt, token.hex40id, showDebugLog)
        showDebugLog && console.log(`${new Date().toISOString()} calcDailyToken finish : ${token.symbol} ${token.base32}`)
    }
    console.log(`${new Date().toISOString()} calcAllRegisteredTokenDailyStat done.`)
}
export async  function countRecentTokenTransfer(days:number) : Promise<{txnCount, userCount}> {
    const sum = await DailyTokenTxn.findOne({
        attributes: [
            [fn('sum', col('txnCount')),'txnCount'],
            [fn('sum', col('userCount')),'userCount'],
        ],
        where: {
            day: {[Op.gt]: fn('addtime', fn('now'), `${days} 0:0:0`)},
            type: {[Op.in]:['_ALL_4','ERC1155','ERC721','ERC20']},
            },
        logging: msg=>console.log(` countRecentTokenTransfer: ${msg}`),
    })
    return sum;
    // return Promise.all([
    //     Erc20Transfer.count(options),
    //     Erc721Transfer.count(options),
    //     Erc777Transfer.count(options),
    //     Erc1155Transfer.count(options),
    // ]).then(arr=>arr.reduce((a,b)=>a+b))
}
export async  function countRecentTokenTransferAccount(days:number) {
    // const options = {where:{createdAt:{[Op.gt]: fn('addtime', fn('now'), `${days} 0:0:0`)}}}
    const timeWhere = `where createdAt >= addTime(now(),'${days} 0:0:0')`
    function countAccount(t:string) : Promise<number> {
        const sql = `select count(*) as cnt from (select fromId from ${t} ${timeWhere} union select toId from ${t} ${timeWhere} ) t`
        return Erc20Transfer.sequelize.query(sql,{
                // logging: console.log,
                type:QueryTypes.SELECT,})
            .then(arr=> {
                // console.log(`result is ${JSON.stringify(arr)}`)
                return Number(arr[0]['cnt'])
            })
    }
    return Promise.all([
        countAccount(T_ERC20_TRANSFER),
        countAccount(T_ERC721_TRANSFER),
        // countAccount(T_ERC777_TRANSFER),
        countAccount(T_ERC1155_TRANSFER),
    ]).then(arr=>arr.reduce((a,b)=>a+b))
}

export async  function getTokenModel(tokenHexId:number) : Promise<[any,Token]> {
        const tokenBean = await Token.findOne({where: {hex40id: tokenHexId}})
        if (tokenBean === null) {
            console.log(`${new Date().toISOString()} token not found, hex id ${tokenHexId}`)
            return [null,null]
        }
        let model
        switch(tokenBean.type.toLowerCase()) {
            case 'erc20': model = Erc20Transfer; break;
            case 'erc721': model = Erc721Transfer; break;
            // case 'erc777': model = Erc777Transfer; break;
            case 'erc1155': model = Erc1155Transfer; break;
            default:
                // console.log(`unknown token type [${tokenBean.type}], ${tokenBean.base32}, ${tokenBean.symbol}`)
                return [null, tokenBean];
        }
        return [model, tokenBean]
}
export async  function calcDailyTokenAmount(dt:Date, tokenHexId:number) {
    const [model, tokenBean] = await getTokenModel(tokenHexId)
    if (model === null) {
        return;
    }
    console.log(`${__filename} calcDailyTokenAmount ${tokenHexId}`)
    let start = new Date(dt); start.setUTCHours(0,0,0,0)
    let end = new Date(dt);   end.setUTCHours(23,59,59,999)
    adjustTodayEndTime(end)
    const [startE, endE] = await getEpochRange(start, end)
    if (showDebugLog) {
        console.log(` time range ${start.toISOString()}  ${end.toISOString()}`)
        console.log(` epoch range ${startE}  ${endE}`)
    }

    let dailyTokenWhere = {where: {hexId: tokenHexId, day: start}};
    const dailyToken = DailyToken.findOne(dailyTokenWhere)
    if (dailyToken == null) {
        console.log(`daily token not found ${tokenHexId}, ${start}`)
        return;
    }
    let preId = 0;
    const sql = `select id,\`value\` from ${model.getTableName()} where contractId=?
            and epoch between ? and ? and id > ? order by id asc limit ?`
    const pageSize = 1000;
    let sum = BigInt(0)
    do {
        await model.sequelize.query(sql,{type:QueryTypes.SELECT,
            logging: showDebugLog ? console.log:false,
            replacements:[tokenHexId, startE, endE, preId, pageSize]}).then(list=>{
                list.forEach(row=>{
                    sum += BigInt(row.value)
                })
            if (list.length > 0) {
                preId = list[list.length-1].id
                console.log(`token ${tokenBean.hex40id} ${tokenBean.symbol} ${tokenBean.base32
                } transfer records:${list.length}  `)

                } else {
                preId = -1 // stop while
            }
        }).catch(err=>{
            console.log(`query transfer fail: ${sql}`, err)
            preId = -1
        })
    } while (preId > 0)
    await DailyToken.update({transferAmount: sum.toString()},dailyTokenWhere)
        .then(([cnt])=>{
            // console.log(` update daily token transfer amount to ${sum} affect rows ${cnt}, day ${start.toISOString()}`)
        })
}
export async  function calcDailyToken(dt:Date, tokenHexId:number, showLog = false) {
    const [model, tokenBean] = await getTokenModel(tokenHexId)
    if (model === null) {
        return;
    }
    //
        let start = new Date(dt); start.setUTCHours(0,0,0,0)
        let end = new Date(dt);   end.setUTCHours(23,59,59,999)
        adjustTodayEndTime(end)
        const [startE, endE] = await getEpochRange(start, end)
        if (showLog) {
            console.log(` time range ${start.toISOString()}  ${end.toISOString()}`)
            console.log(` epoch range ${startE}  ${endE}`)
        }
        const sql = `select contractId as hexId, count(*) as transferCount, count(distinct(fromId)) as uniqueReceiver,
            count(distinct(toId)) uniqueSender from ${model.getTableName()} where contractId=?
            and epoch between ? and ?`
        const stat:DailyToken = (await model/*Erc20Transfer*/.sequelize.query(sql, {type:QueryTypes.SELECT,
            replacements:[tokenHexId, startE, endE],
            logging: showLog ? console.log : false,
        }))[0] as DailyToken
        stat.createdAt = end;
        if (stat.hexId === null) {
            stat.hexId = tokenHexId
            showDebugLog && console.log(`\nStat is empty for  ${tokenBean.type}, ${tokenBean.base32}, ${tokenBean.symbol
                } day ${start.toISOString()}, table ${model.getTableName()}`)
        }
        stat.day = start
        // console.log(`stat got :`, stat);
        const [updatedCnt] = await DailyToken.update(stat, {where: {hexId: tokenHexId, day: start}})
        if (updatedCnt === 0) {
            await DailyToken.create(stat as DailyToken)
            showDebugLog && console.log(` create daily token stat : ${tokenBean.symbol}`)
        } else {
            showDebugLog && console.log(` update daily token stat : ${tokenBean.symbol}`)
        }
        if (tokenBean.type.includes('20') || tokenBean.type.includes('777')) {
             await calcDailyTokenAmount(dt, tokenHexId).catch(err=>{
                 console.log(`calcDailyTokenAmount fail, ${dt.toISOString()} ${tokenHexId}`, err)
             })
        }
    // holder count
    const banModel = BalanceWatcher.mapModel('', true, tokenBean.hex40id)
    if (banModel) {
        await banModel.count().then(cnt => {
            return DailyToken.update({holderCount: cnt}, {where: {hexId: tokenHexId, day: start}})
        }).catch(err => {
            console.log(`update daily token holder fail ${tokenBean.hex40id}:`, err)
        })
    }
}
