import { col, fn, Op} from 'sequelize'
import {
    calcAllTokenUniqueUser,
    DailyTokenTxn,
    Erc20Transfer,
    TOKEN_TYPE_ALL_4
} from "../model/Erc20Transfer";
import {DailyToken, Token} from "../model/Token";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {QueryTypes} from "sequelize";
import {BalanceWatcher} from "./watcher/BalanceWatcher";
import {adjustTodayEndTime, getEpochRange, patchDateOnlyField} from "../model/Utils";
import {TxnQuery} from "./TxnQuery";
import {getMaxTokenSyncDate} from "./tool/FixDailyTokenStat";
import {FullBlock} from "../model/FullBlock";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {fmtAddr, StatApp} from "../StatApp";

let showDebugLog = true
export async  function scheduleDailyTokenStat() {
    showDebugLog = false

    const endT = await getMaxTokenSyncDate();
    const minBlockDt = await FullBlock.findOne({order:[['epoch', 'asc']], offset: 1})
    const fromT = await DailyToken.findOne({order:[['day', 'desc']], raw: true}).then(patchDateOnlyField)
        .then(res=>res?.day || minBlockDt?.createdAt);
    while (fromT < endT) {
        await calcAllRegisteredTokenDailyStat(fromT).catch(e=>{
            safeAddErrorLog('stat-task', 'daily-token', e).then();
            console.log(`failed to calcAllRegisteredTokenDaily Stat`, e)
        });
        fromT.setDate(fromT.getDate()+1);
    }

    setTimeout(scheduleDailyTokenStat, 1000*60*30)
}

export async  function calcAllRegisteredTokenDailyStat(dt:Date) {
    console.log(`${new Date().toISOString()} begin calculate token's daily statistics`);
    let idGreatThan = 0;
    let counter = 0;
    let ms = Date.now();
    while (true) {
        counter ++;
        if (counter % 100 == 0) {
            const now = Date.now();
            if (now - ms > 60_1000) {
                // 1-minute elapsed
                ms = now;
                console.log(`processed daily token stat ${counter} ${new Date().toISOString()}`);
            }
        }
        idGreatThan = await calcOneTokenDailyStat(dt, idGreatThan);
        if (!idGreatThan) {
            break;
        }
    }
    console.log(`${new Date().toISOString()} calcAllRegisteredTokenDailyStat done. count ${counter}`);
}
async  function calcOneTokenDailyStat(dt:Date, idGreatThan: number) {
    let _sql = '';
    const token = await Token.findOne({
        attributes: ['hex40id','symbol','name','base32'],
        where: {id: {[Op.gt]: idGreatThan}},
        logging: sql => _sql = sql,
    })
    if (!token) {
        console.log(`token not found, id > `, idGreatThan);
        console.log(`sql is `, _sql);
        return null;
    }
    await calcDailyTokenEach(dt, token.hex40id, showDebugLog)
    showDebugLog && console.log(`${new Date().toISOString()} calcDailyToken finish : ${token.symbol
        } ${fmtAddr(token.base32, StatApp.networkId)}`);
    return token.id;
}

export async  function countRecentTokenTransfer(days:number) : Promise<{txnCount:number, userCount:number}> {
    const {beginTime, endTime} = TxnQuery.buildTimeRange(days);
    if (days == -1) {
        //recent 24 hours
        const [txnCount, userCount] = await  calcAllTokenUniqueUser(beginTime, endTime);
        return {txnCount, userCount}
    }
    return DailyTokenTxn.findOne({
        attributes: [
            [fn('sum', col('txnCount')),'txnCount'],
            [fn('sum', col('userCount')),'userCount'],
        ],
        where: {
            day: {[Op.between]: [beginTime, endTime]},
            type: TOKEN_TYPE_ALL_4,
            },
        logging: msg=>console.log(` countRecentTokenTransfer: ${msg}`),
    })
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
            case 'erc1155': model = Erc1155Transfer; break;
            default:
                // console.log(`unknown token type [${tokenBean.type}], ${tokenBean.base32}, ${tokenBean.symbol}`)
                return [null, tokenBean];
        }
        return [model, tokenBean]
}

export async  function calcDailyTokenAmount(dt:Date, tokenHexId:number) {
    const [model, tokenBean, start, end] = await checkModelAndTime(dt, tokenHexId);
    if (!model) {
        return
    }
    let [startE, endE] = await getEpochRange(start, end)
    if (showDebugLog) {
        console.log(`${__filename} calcDailyTokenAmount ${tokenHexId}`)
        console.log(` time range ${start.toISOString()}  ${end.toISOString()}`)
        console.log(` epoch range ${startE}  ${endE}`)
    }

    let dailyTokenWhere = {where: {hexId: tokenHexId, day: start}};
    const dailyToken = DailyToken.findOne(dailyTokenWhere)
    if (dailyToken == null) {
        console.log(`daily token not found ${tokenHexId}, ${start}`)
        return;
    }
    const sql = `select epoch,\`value\` from ${model.getTableName()} where contractId=?
            and epoch between ? and ? order by epoch asc limit ?`
    const pageSize = 10000;
    let sum = BigInt(0)
    do {
        await model.sequelize.query(sql,{type:QueryTypes.SELECT,
            logging: showDebugLog ? console.log:false,
            replacements:[tokenHexId, startE, endE, pageSize]}).then(list=>{
                list.forEach(row=>{
                    sum += BigInt(row.value)
                })
            if (list.length > 0) {
                startE = list[list.length-1].epoch + 1;
                console.log(`token ${tokenBean.hex40id} ${tokenBean.symbol} ${tokenBean.base32
                } transfer records:${list.length}  `)
            } else {
                startE = endE + 1;
            }
        }).catch(err=>{
            safeAddErrorLog('token-x',`query-transfer`, err);
            console.log(`query transfer fail: ${sql}`, err)
            startE = endE + 1;
        })
    } while (startE <= endE);
    await DailyToken.update({transferAmount: sum.toString()},dailyTokenWhere)
        .then(([_])=>{
            // console.log(` update daily token transfer amount to ${sum} affect rows ${cnt}, day ${start.toISOString()}`)
        })
}

async function checkModelAndTime(dt:Date, tokenHexId:number) {
    const [model, tokenBean] = await getTokenModel(tokenHexId);
    if (model === null) {
        return [];
    }
    let start = new Date(dt); start.setUTCHours(0,0,0,0)
    let end = new Date(dt);   end.setUTCHours(23,59,59,999);
    adjustTodayEndTime(end)
    return [model, tokenBean, start, end];
}

export async  function calcDailyTokenEach(dt:Date, tokenHexId:number, showLog = false) {
    const [model, tokenBean, start, end] = await checkModelAndTime(dt, tokenHexId);
    if (!model) {
        return
    }
        const [startE, endE] = await getEpochRange(start, end);
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
            showDebugLog && console.log(` create daily token stat : ${tokenBean.symbol} ${tokenHexId}`)
        } else {
            showDebugLog && console.log(` update daily token stat : ${tokenBean.symbol} ${tokenHexId}`)
        }
        if (tokenBean.type.includes('20') || tokenBean.type.includes('777')) {
             await calcDailyTokenAmount(dt, tokenHexId).catch(err=>{
                 safeAddErrorLog('token-x',`daily-amount-${tokenBean.address}`, err);
                 console.log(`calcDailyTokenAmount fail, ${dt.toISOString()} ${tokenHexId}`, err)
             })
        }
    // holder count
    const banModel = BalanceWatcher.mapModel('', true, tokenBean.hex40id)
    if (banModel) {
        await banModel.count().then(cnt => {
            return DailyToken.update({holderCount: cnt}, {where: {hexId: tokenHexId, day: start}})
        }).catch(err => {
            safeAddErrorLog('contract',`update-token-holder-${tokenBean.address}`, err);
            console.log(`update daily token holder fail ${tokenBean.hex40id}:`, err)
        })
    }
}
