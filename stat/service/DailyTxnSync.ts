import {DailyTransaction, IDailyTransaction} from "../model/DailyTransaction";
import {calBeginEndTime, getNextDelay, getYesterday} from "./tool/DateTool";
import {fn, Op, Sequelize, Model, col} from 'sequelize'
import {DailyTokenTxn, Erc20Transfer, T_ERC20_TRANSFER} from "../model/Erc20Transfer";
import {DailyToken, Token} from "../model/Token";
import {Erc721Transfer, T_ERC721_TRANSFER} from "../model/Erc721Transfer";
import {Erc1155Transfer, T_ERC1155_TRANSFER} from "../model/Erc1155Transfer";
import {Erc777Transfer, T_ERC777_TRANSFER} from "../model/Erc777Transfer";
import {QueryTypes} from "sequelize";
import {BalanceWatcher} from "./watcher/BalanceWatcher";
import {FullTransaction} from "../model/FullBlock";

const CONST = require('./common/constant');

export class DailyTxnSync{

    constructor() {
    }

    public async countDaily(day: Date){
        const {beginTime, endTime} = calBeginEndTime(day);

        const stat:any = await FullTransaction.findOne({
            attributes:[
                [fn('sum',col('gas')), 'gasFee'],
                [fn('count',col('*')), 'txCount'],
            ],
            where: {
                [Op.and]:[
                    {createdAt: {
                        [Op.gte]:beginTime
                    }},
                    {createdAt: {
                        [Op.lt]:endTime
                    }},
                    {status: 0}
                ]
            },
            logging: console.log,
            raw: true
        });
        const {txCount, gasFee} = stat;
        const dailyTransaction = new DailyTransaction();
        dailyTransaction.statDay = endTime;
        dailyTransaction.txCount = txCount;
        dailyTransaction.gasFee = gasFee || 0;
        const newRecord = await DailyTransaction.add(dailyTransaction);
        console.log('count daily_tx record:' + JSON.stringify(newRecord));
    }

    public async countHistory(startDay?: Date, endDay?: Date){
        const start = startDay || new Date('2020/10/29');
        const end = endDay || getYesterday(new Date());
        do{
            await this.countDaily(start);
            start.setDate(start.getDate() + 1)
        } while(start.getTime() <= end.getTime());
    }

    // 16:10:00 UTC
    public async schedule() {
        const that = this;
        async function repeat() {
            const now = new Date();
            await that.countDaily(getYesterday(now)).catch(err=>{
                console.log(`count daily_tx fail: `, err);
            });
            const delay = 3600_000 ;
            console.log(`schedule daily_tx service in delay 1 hour.`);
            setTimeout(repeat, delay);
        }
        repeat().then();
    }
}
let showDebugLog = true
export async  function scheduleDailyTokenStat() {
    showDebugLog = false
    return calcAllRegisteredTokenDailyStat(new Date())
        .then(()=>setTimeout(scheduleDailyTokenStat, 1000*3600*4))
}
export async  function calcAllRegisteredTokenDailyStat(dt:Date) {
    const tokenList = await Token.findAll({
        attributes: ['hex40id','symbol','name','base32'],
        where: {auditResult: true},
    })
    console.log(`${new Date().toISOString()} begin calculate token's daily statistics:`)
    for(const token of tokenList) {
        await calcDailyToken(dt, token.hex40id)
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
        countAccount(T_ERC777_TRANSFER),
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
            case 'erc777': model = Erc777Transfer; break;
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
    let start = new Date(dt); start.setUTCHours(0,0,0,0)
    let end = new Date(dt);   end.setUTCHours(23,59,59,999)
    let dailyTokenWhere = {where: {hexId: tokenHexId, day: start}};
    const dailyToken = DailyToken.findOne(dailyTokenWhere)
    if (dailyToken == null) {
        console.log(`daily token not found ${tokenHexId}, ${start}`)
        return;
    }
    let preId = 0;
    const sql = `select id,\`value\` from ${model.getTableName()} where contractId=?
            and createdAt between ? and ? and id > ? order by id asc limit ?`
    const pageSize = 1000;
    let sum = BigInt(0)
    do {
        await model.sequelize.query(sql,{type:QueryTypes.SELECT,
            replacements:[tokenHexId, start, end, preId, pageSize]}).then(list=>{
                list.forEach(row=>{
                    sum += BigInt(row.value)
                })
            if (list.length > 0) {
                preId = list[list.length-1].id
            } else {
                preId = -1 // stop while
            }
            process.stdout.write(`\r${CONST.CL} token ${tokenBean.hex40id} ${tokenBean.symbol} ${tokenBean.base32
                } transfer records:${list.length}  `)
        }).catch(err=>{
            console.log(`query transfer fail: ${sql}`, err)
            preId = -1
        })
    } while (preId > 0)
    await DailyToken.update({transferAmount: sum.toString()},dailyTokenWhere)
        .then(([cnt])=>{
            // process.stdout.write(`\r${CONST.CL}update daily token transfer amount to ${sum} affect rows ${cnt}, day ${start.toISOString()}`)
        })
}
export async  function calcDailyToken(dt:Date, tokenHexId:number) {
    const [model, tokenBean] = await getTokenModel(tokenHexId)
    if (model === null) {
        return;
    }
    //
        let start = new Date(dt); start.setUTCHours(0,0,0,0)
        let end = new Date(dt);   end.setUTCHours(23,59,59,999)
        const sql = `select contractId as hexId, count(*) as transferCount, count(distinct(fromId)) as uniqueReceiver,
            count(distinct(toId)) uniqueSender from ${model.getTableName()} where contractId=?
            and createdAt between ? and ?`
        const stat:DailyToken = (await model/*Erc20Transfer*/.sequelize.query(sql, {type:QueryTypes.SELECT,
            replacements:[tokenHexId, start, end],
            // logging: console.log
        }))[0] as DailyToken
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
            showDebugLog && process.stdout.write(`\r ${CONST.CL} create daily token stat : ${tokenBean.symbol}`)
        } else {
            showDebugLog && process.stdout.write(`\r ${CONST.CL} update daily token stat : ${tokenBean.symbol}`)
        }
        if (tokenBean.type.includes('20') || tokenBean.type.includes('777')) {
             await calcDailyTokenAmount(dt, tokenHexId).catch(err=>{
                 console.log(`calcDailyTokenAmount fail, ${dt.toISOString()} ${tokenHexId}`, err)
             })
        }
    // holder count
    const banModel = BalanceWatcher.mapModel(tokenBean.symbol, true, tokenBean.hex40id)
    if (banModel) {
        banModel.count({}).then(cnt => {
            return DailyToken.update({holderCount: cnt}, {where: {hexId: tokenHexId, day: start}})
        }).catch(err => {
            console.log(`update daily token holder fail ${tokenBean.hex40id}:`, err)
        })
    }
}
