import {CfxBalance} from "../model/Balance";
import {DailyCfxHolder, IDailyCfxHolder} from "../model/DailyCfxHolder";
import {calBeginEndTime, getYesterday, getNextDelay} from "./tool/DateTool";
import {Op, Sequelize} from 'sequelize'

export class CfxHolderSync{
    private sequelize: Sequelize;

    constructor(sequelize: Sequelize) {
        this.sequelize = sequelize;
    }

    private async countDaily(day: Date): Promise<IDailyCfxHolder>{
        const {endTime} = calBeginEndTime(day);
        const record = await DailyCfxHolder.findOne({where: {statDay: endTime}})
        if(record) return Promise.resolve(record);

        const holderCount = await CfxBalance.count({});
        const dailyCfxHolder = new DailyCfxHolder();
        dailyCfxHolder.statDay = endTime;
        dailyCfxHolder.holderCount = holderCount;
        const newRecord = await DailyCfxHolder.add(dailyCfxHolder);
        console.log('count daily_cfx_holder record:' + JSON.stringify(newRecord));
        return Promise.resolve(newRecord);
    }

    // 16:10:00 UTC
    public async schedule() {
        const that = this;
        async function repeat() {
            const now = new Date();
            await that.countDaily(getYesterday(now)).catch(err=>{
                console.log(`count daily_cfx_holder fail: `, err);
            });
            const delay = getNextDelay(now, 1, 10);
            console.log(`schedule daily_cfx_holder service in delay ${delay/1000}s.`);
            setTimeout(repeat, delay);
        }
        repeat().then();
    }
}