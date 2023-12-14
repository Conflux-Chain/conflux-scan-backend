import {Op, QueryTypes} from 'sequelize'
import {DailyContractRegister} from "../../model/DailyContractRegister";
import {Contract} from "../../model/Contract";
import {DailyTransaction} from "../../model/DailyTransaction";
import {Epoch} from "../../model/Epoch";
import {fmtDtUTC} from "../../model/Utils";
import {IntervalType, TimerStat} from "./TimerStat";
import {DailyContractCreate} from "../../model/DailyContractCreate";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class StatDailyContractRegister extends TimerStat{

    constructor(app: any) {
        super(app);
        this.baseInterval = IntervalType.TEN_MIN;
    }

    public bizAlias(): string {
        return `${DailyContractRegister.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyContractRegister.findOne({
            where: {statType: this.baseInterval},
            order:[["statDay","desc"]],
            limit: 1
        });
        return this.getStatRangeMin(lastStat, 10);
    }

    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        return Epoch.findOne({
            attributes:['epoch'],
            where: {timestamp: {[Op.gte]: rangeEnd}},
            order:[['timestamp', 'asc']],
            limit: 1
        }).then(item => item?.epoch);
    }

    public async stat(rangeBegin: Date, rangeEnd: Date){
        const mStat = await this.statRaw(rangeBegin, rangeEnd);
        const dStat = await this.statAnalysis(rangeEnd, IntervalType.TEN_MIN, IntervalType.DAY, mStat);
        this.debug && console.log(`debug-5,mStat:${JSON.stringify(mStat)},dStat:${JSON.stringify(dStat)}`);

        const statArray = [mStat, dStat];
        await DailyContractRegister.sequelize.transaction(async (dbTx) => {
            await DailyContractRegister.destroy({
                where: {statType: dStat.statType, statDay: dStat.statDay}, transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]destroy ${msg}`),*/
            });
            await DailyContractRegister.bulkCreate(statArray, {
                transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]bulkCreate ${msg}`),*/
            });
        });
        console.log(`[${this.bizAlias()}]record:${JSON.stringify(statArray)}`);
    }

    // ------------------------------- biz -----------------------------------
    public async statRaw(beginTime: Date, endTime: Date): Promise<DailyContractRegister> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval);

        const contractCount = await Contract.count({
            where: {
                [Op.and]:[
                    {createdAt: {[Op.gte]: beginTime}},
                    {createdAt: {[Op.lt]: endTime}}
                ]},
            /*logging: msg => console.log(`[${this.bizAlias()}]contact register query ${msg}`)*/
        });

        return {
            statDay: beginTime, statType: intervalType, contractCount
        } as DailyContractRegister;
    }

    public async statAnalysis(endTime: Date, srcStatType: IntervalType, destStatType: IntervalType,
                              latestStat = undefined): Promise<DailyContractRegister> {
        const beginTime = this.getRangeBegin(endTime, destStatType);

        const statSql = `SELECT statDay,statType,contractCount FROM daily_contract_register 
                    WHERE statType = '${srcStatType}' and statDay >= ? and statDay < ?` ;
        const statList = await DailyContractRegister.sequelize.query(statSql, { type: QueryTypes.SELECT, raw: true,
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
            /*logging: msg => console.log(`[${this.bizAlias()}]stat list query ${msg}`)*/
        });
        if(latestStat) {
            statList.push(latestStat);
        }

        const statDay = beginTime;
        let contractCount = BigFixed(0);
        lodash.forEach(statList, stat => {
            contractCount = contractCount.add(BigFixed(stat['contractCount']));
        });

        return {statDay, statType: destStatType, contractCount} as DailyContractRegister;
    }
}
