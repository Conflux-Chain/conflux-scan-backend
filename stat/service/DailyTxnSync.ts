import {TransactionDB} from "../model/Transaction";
import {DailyTransaction, IDailyTransaction} from "../model/DailyTransaction";
import {calBeginEndTime, getNextDelay, getYesterday} from "./tool/DateTool";
import {Model, Op, Sequelize, QueryTypes} from 'sequelize'
import {Erc20Transfer} from "../model/Erc20Transfer";
import {DailyToken, Token} from "../model/Token";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {Erc777Transfer} from "../model/Erc777Transfer";

export class DailyTxnSync{
    private sequelize: Sequelize;

    constructor(sequelize: Sequelize) {
        this.sequelize = sequelize;
    }

    private async countDaily(day: Date): Promise<IDailyTransaction>{
        const {beginTime, endTime} = calBeginEndTime(day);
        const record = await DailyTransaction.findOne({where: {statDay: endTime}})
        if(record) return Promise.resolve(record);

        const txCount = await TransactionDB.count({
            where: {
                [Op.and]:[
                    {blockTime: {
                        [Op.gte]:beginTime
                    }},
                    {blockTime: {
                        [Op.lt]:endTime
                    }}
                ]
            }
        });
        const dailyTransaction = new DailyTransaction();
        dailyTransaction.statDay = endTime;
        dailyTransaction.txCount = txCount;
        const newRecord = await DailyTransaction.add(dailyTransaction);
        console.log('count daily_tx record:' + JSON.stringify(newRecord));
        return Promise.resolve(newRecord);
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
    public async schedule(countHistory: boolean) {
        const that = this;
        async function repeat() {
            const now = new Date();
            await that.countDaily(getYesterday(now)).catch(err=>{
                console.log(`count daily_tx fail: `, err);
            });
            const delay = getNextDelay(now, 1, 10);
            console.log(`schedule daily_tx service in delay ${delay/1000}s.`);
            setTimeout(repeat, delay);
        }
        if(countHistory){
            await this.countHistory();
        }
        repeat().then();
    }

    public async calcDailyToken(dt:Date, tokenHexId:number) {
        const tokenBean = await Token.findOne({where: {hex40id: tokenHexId}})
        if (tokenBean === null) {
            console.log(`${new Date().toISOString()} token not found, hex id ${tokenHexId}`)
            return
        }
        let model
        switch(tokenBean.type.toLowerCase()) {
            case 'erc20': model = Erc20Transfer; break;
            case 'erc721': model = Erc721Transfer; break;
            case 'erc777': model = Erc777Transfer; break;
            case 'erc1155': model = Erc1155Transfer; break;
            default:
                console.log(`unknown token type [${tokenBean.type}], ${tokenBean.base32}, ${tokenBean.symbol}`)
                return
        }
        //
        let start = new Date(dt); start.setUTCHours(0,0,0,0)
        let end = new Date(dt);   end.setUTCHours(23,59,59,999)
        const sql = `select contractId as hexId, count(*) as transferCount, count(distinct(fromId)) as uniqueReceiver,
            count(distinct(toId)) uniqueSender from erc20transfer where contractId=?
            and createdAt between ? and ?`
        const stat:DailyToken = (await model/*Erc20Transfer*/.sequelize.query(sql, {type:QueryTypes.SELECT,
            replacements:[tokenHexId, start, end],
            logging: console.log
        }))[0] as DailyToken
        if (stat.hexId === null) {
            stat.hexId = tokenHexId
            console.log(`stat is empty for  ${tokenBean.type}, ${tokenBean.base32}, ${tokenBean.symbol} day ${start}`)
        }
        stat.day = start
        console.log(`stat got :`, stat);
        const [updatedCnt] = await DailyToken.update(stat, {where: {hexId: tokenHexId, day: start}})
        if (updatedCnt === 0) {
            await DailyToken.create(stat as DailyToken)
            console.log(`create daily token stat :`, stat)
        } else {
            console.log(`update daily token stat :`, stat)
        }
    }
}