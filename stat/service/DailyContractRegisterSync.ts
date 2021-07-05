import {DailyContractRegister, IDailyContractRegister} from "../model/DailyContractRegister";
import {Contract} from "../model/Contract";
import {calBeginEndTime, getYesterday, getNextDelay} from "./tool/DateTool";
import {Op, Sequelize} from 'sequelize'

export class DailyContractRegisterSync{
    private sequelize: Sequelize;

    constructor(sequelize: Sequelize) {
        this.sequelize = sequelize;
    }

    private async countDaily(day: Date): Promise<IDailyContractRegister>{
        const {beginTime, endTime} = calBeginEndTime(day);
        const record = await DailyContractRegister.findOne({where: {statDay: endTime}})
        if(record) return Promise.resolve(record);

        const contractCount = await Contract.count({
            where: {[Op.and]:[{createdAt: {[Op.gte]:beginTime}},
                    {createdAt: {[Op.lt]:endTime}}]}
        });
        const dailyContractRegister = new DailyContractRegister();
        dailyContractRegister.statDay = beginTime;
        dailyContractRegister.contractCount = contractCount;
        const newRecord = await DailyContractRegister.add(dailyContractRegister);
        console.log(`count daily_contract_register record:${JSON.stringify(newRecord)}`);
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
                console.log(`count daily_contract_register fail: `, err);
            });
            const delay = getNextDelay(now, 1, 10);
            console.log(`schedule daily_contract_register service in delay ${delay/1000}s.`);
            setTimeout(repeat, delay);
        }
        repeat().then();
    }
}
