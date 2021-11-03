import {DailyContractCreate, IDailyContractCreate} from "../model/DailyContractCreate";
import {calBeginEndTime, getYesterday, getNextDelay} from "./tool/DateTool";
import {Op, Sequelize} from 'sequelize'
import {TraceCreateContract} from "../model/TraceCreateContract";

export class DailyContractCreateSync{
    private sequelize: Sequelize;

    constructor(sequelize: Sequelize) {
        this.sequelize = sequelize;
    }

    private async countDaily(day: Date): Promise<IDailyContractCreate>{
        const {beginTime, endTime} = calBeginEndTime(day);
        const record = await DailyContractCreate.findOne({where: {statDay: endTime}})
        if(record) return Promise.resolve(record);

        const contractCount = await TraceCreateContract.count({
            where: {
                [Op.and]:[
                    {blockTime: {
                        [Op.gte]:beginTime.getTime() / 1000
                    }},
                    {blockTime: {
                        [Op.lt]:endTime.getTime() / 1000
                    }}
                ]
            }
        });
        const dailyContractCreate = new DailyContractCreate();
        dailyContractCreate.statDay = endTime;
        dailyContractCreate.contractCount = contractCount;
        const newRecord = await DailyContractCreate.add(dailyContractCreate);
        console.log('count daily_contract_create record:' + JSON.stringify(newRecord));
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
    public async schedule() {
        const that = this;
        async function repeat() {
            const now = new Date();
            await that.countDaily(getYesterday(now)).catch(err=>{
                console.log(`count daily_contract_create fail: `, err);
            });
            const delay = getNextDelay(now, 1, 10);
            console.log(`schedule daily_contract_create service in delay ${delay/1000}s.`);
            setTimeout(repeat, delay);
        }
        repeat().then();
    }
}