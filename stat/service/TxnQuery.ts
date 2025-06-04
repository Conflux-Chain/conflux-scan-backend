import {idHex40Map} from "../model/HexMap";
import {col, fn, Op} from 'sequelize'
// @ts-ignore
import {format} from 'js-conflux-sdk'
import {StatApp} from "../StatApp";
import {DailyTransaction} from "../model/DailyTransaction";
import {FullTransaction} from "../model/FullBlock";
import {Errors} from "./common/LogicError";
import {PATH_TOP_BY_GAS} from "./CacheService";
import {ethers} from "ethers";
import {IntervalType} from "./timerstat/TimerStat";
import {GasConsumer, IGasConsumer} from "../model/GasConsumer";
import {sqlLogFn} from "../model/Utils";
import {NoCoreSpace} from "../config/StatConfig";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";

export class TxnQuery{
    static cacheFilePrefix = PATH_TOP_BY_GAS;
    static buildTimeRange(days: number) {
        let beginTime = new Date();
        beginTime.setDate(beginTime.getDate() + days);
        beginTime.setMinutes(0, 0, 0);

        let endTime = new Date();
        endTime.setMinutes(0, 0, 0);
        return {beginTime, endTime};
    }
    // parameter days is negative.
    static async gasUsedSum(days:number) : Promise<{txCount, gasFee}> {
        const {beginTime, endTime} = TxnQuery.buildTimeRange(days);
        let statType = IntervalType.DAY;
        if (days == -1) {
            statType = IntervalType.TEN_MIN;
        }
        const sum = await DailyTransaction.findOne({
            attributes: [
                [fn('sum', col('txCount')),'txCount'],
                [fn('sum', col('gasFee')),'gasFee'],
            ],
            where: {
                statDay: {[Op.between]: [beginTime, endTime],},
                statType,
            },
            // logging: console.log,
        })
        return sum;
    }

    static async topByGasUsed({span = '24h'}) {
        const emptyResult = {/*code: 0,*/ totalGas: 0, list:[]};
        const def = {'24h': -1, '3d': -3, '7d': -7}

        let spanDay = def[span];
        if (spanDay === undefined) {
            /*return {code: 610, message: `unknown span [${span}], support ${Object.keys(def).join(',')}`}*/
            throw new Errors.ParameterError(`unknown span [${span}], support ${Object.keys(def).join(',')}`);
        }

        // convert createAt to epoch
        const minTime = new Date();
        minTime.setMinutes(0, 0, 0);
        minTime.setDate(minTime.getDate() + spanDay);
        const list = await
            GasConsumer.findAll({
                attributes: [
                    [fn('sum',col('gas')), 'gas'],
                    'addrId',
                ],
                group: ['addrId'], raw: true, benchmark: true,
                // logging: sqlLogFn(`gas consumer rank`),
                where: {
                    [Op.and]: [
                        {statType: span=='24h' ? '1h' : '1d'},
                        {statTime: {[Op.gte]: minTime}}
                    ]
                },
                order: [[col('gas'),'desc']], limit: 10,
            });
        if (!list.length) {
            return emptyResult;
        }
        const sumGas = list.map(row=>BigInt(row['gas'])).reduce((a,b)=>a+b);
        const hexMap = await idHex40Map(list.map(row=>row['addrId']));
        list.forEach(row=>{
            row['hex'] = ethers.utils.getAddress(`0x${hexMap.get(row['addrId'])}`);
            !NoCoreSpace && (row['base32'] = TxnQuery.base32(row['hex'], StatApp.networkId));
        })
        return {totalGas: sumGas, list, minTime}
    }

    static base32(hex, networkId) {
        if (hex === null || hex === undefined || hex === '') {
            return ''
        }
        return format.address(hex, networkId)
    }

    public topGasUsedCache = {};
    public async scheduleCache(delay: number = 600_000) {
        console.log(`schedule top_gas_used with delay:${delay}`)
        const that = this
        async function repeat() {
            await that.updateTopGasUsed().catch(err =>{
                console.log(`schedule top_gas_used error:${err}`)
            })
            setTimeout(repeat, delay)
        }
        repeat().then()
    }
    public async updateTopGasUsed() {
        // execute sql sequentially in order to reduce db load
        const d7 = await TxnQuery.topByGasUsed({span: '7d'})
        const d3 = await TxnQuery.topByGasUsed({span: '3d'})
        const h24 = await TxnQuery.topByGasUsed({span: '24h'})
        this.topGasUsedCache = {
            '7d': d7,
            '3d': d3,
            '24h': h24,
        };
    }
}

export function scheduleGasConsumerStat() {
    setInterval(()=>{
        statGasConsumer(new Date()).catch(e=>{
            safeAddErrorLog('stat-task', 'gas-consumer', e).then();
            console.log(`stat Gas Consumer error`, e)
        });
    }, 60_0_000);
}

async function statGasConsumer(dt: Date) {
    let [lastDay, lastHour] = await Promise.all([
      GasConsumer.findOne({where: {statType: '1d'}, order:[['statTime', 'desc']], raw: true}),
      GasConsumer.findOne({where: {statType: '1h'}, order:[['statTime', 'desc']], raw: true}).then(res=>res as IGasConsumer),
    ]) ;
    let hourT = new Date(dt);
    hourT.setHours(hourT.getHours() - 1, 0, 0, 0);
    if (lastHour == null) {
        // build recent 9 days by hour
        const setupHour = new Date(hourT);
        setupHour.setHours(setupHour.getHours() - 24 * 9);
        lastHour = {statTime: setupHour} as IGasConsumer;
    }
    // hourly stat
    {
        let movingHT = lastHour.statTime;
        while (movingHT.getTime() <= hourT.getTime()) {
            const endT = new Date(movingHT);
            endT.setMinutes(59, 59, 999);
            const statArr = await sumGasUsed({beginTime: movingHT, endTime: endT});
            const beanArr = statArr.map(row => {
                return {addrId: row.fromId, gas: row.gas, statType: '1h', statTime: movingHT, endTime: endT} as IGasConsumer
            })
            await GasConsumer.bulkCreate(beanArr, {updateOnDuplicate: ['gas', 'updatedAt']});
            movingHT.setHours(movingHT.getHours()+1);
        }
    }
    // daily stat
    let dayT = new Date(dt);
    dayT.setDate(dayT.getDate()-1);
    dayT.setHours(0, 0, 0, 0);
    if (lastDay == null) {
        //build recent 8 days by day
        const setupDay = new Date(dayT);
        setupDay.setDate(setupDay.getDate() - 8);
        lastDay = {statTime: setupDay} as GasConsumer;
    }
    let movingDT = lastDay.statTime;
    while (movingDT.getTime() <= dayT.getTime()) {
        const endT = new Date(movingDT);
        endT.setHours(23, 59, 59, 999);
        const sumList = await GasConsumer.findAll({
            attributes: [
                [fn('sum',col('gas')), 'gas'],
                'addrId',
            ],
            group: ['addrId'], raw: true, benchmark: true,
            logging: sqlLogFn('sum gas used 1d'),
            where: {
                statTime: {[Op.between]: [movingDT, endT]},
                statType: '1h',
            }
        });
        const beanArr = sumList.map(({gas, addrId})=>{
            return {addrId, gas, statTime: movingDT, statType: '1d', endTime: endT} as GasConsumer;
        })
        await GasConsumer.bulkCreate(beanArr, {updateOnDuplicate: ['gas', 'updatedAt']});
        movingDT.setDate(movingDT.getDate()+1);
    }
}

async function sumGasUsed({beginTime, endTime}: {beginTime: Date, endTime:Date}) {
    return FullTransaction.findAll({
        attributes: [
            [fn('sum',col('gas')), 'gas'],
            'fromId',
        ],
        group: ['fromId'], raw: true, benchmark: true,
        // logging: sqlLogFn(`sum gas used on full tx`),
        where: {
            createdAt: {[Op.between]: [ beginTime, endTime]},
        },
    });
}
