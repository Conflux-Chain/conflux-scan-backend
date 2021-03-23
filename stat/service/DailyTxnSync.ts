import {TransactionDB} from "../model/Transaction";
import {DailyTransaction, IDailyTransaction} from "../model/DailyTransaction";
import {calBeginEndTime, getYesterday, getNextDelay} from "./tool/DateTool";
import {Op, Sequelize} from 'sequelize'

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
}