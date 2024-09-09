import {idHex40Map} from "../model/HexMap";
import {Op, fn, col} from 'sequelize'
// @ts-ignore
import {format} from 'js-conflux-sdk'
import {StatApp} from "../StatApp";
import {DailyTransaction} from "../model/DailyTransaction";
import {FullTransaction} from "../model/FullBlock";
import {Errors} from "./common/LogicError";
import {Epoch} from "../model/Epoch";
import {loadCache, PATH_TOP_BY_GAS, resolveDockerPath, writeCache} from "./CacheService";
import {ethers} from "ethers";
import {IntervalType} from "./timerstat/TimerStat";
import {GasConsumer, IGasConsumer} from "../model/GasConsumer";

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

    static async topByGasUsed({span = '24h', forceUseCache = false}) {
        const emptyResult = {/*code: 0,*/ totalGas: 0, list:[]};
        const def = {'24h': -1, '3d': -3, '7d': -7}
        const cacheTTL_hour = {'24h': 0.5, '3d': 6, '7d': 12}[span]

        let spanDay = def[span];
        if (spanDay === undefined) {
            /*return {code: 610, message: `unknown span [${span}], support ${Object.keys(def).join(',')}`}*/
            throw new Errors.ParameterError(`unknown span [${span}], support ${Object.keys(def).join(',')}`);
        }
        let cachePath = resolveDockerPath(`${this.cacheFilePrefix}.${span}.json`);
        const cachedData = loadCache(cachePath, forceUseCache ? 0 : 3600 * cacheTTL_hour)
        if (cachedData) {
            return cachedData;
        }

        // convert createAt to epoch
        const minTime = new Date();
        minTime.setMinutes(0, 0, 0);
        minTime.setDate(minTime.getDate() + spanDay);
        let epoch = await Epoch.findOne({
            where: {timestamp: {[Op.gte]: minTime}},
            order: [['timestamp', 'ASC']],
        });
        const latestTx = await FullTransaction.findOne({order: [['epoch', 'desc']]})
        if (latestTx === null) {
            return  emptyResult;
        }
        let endEpoch = latestTx.epoch;
        endEpoch = endEpoch - (endEpoch % 3600);
        if (epoch === null) {
            // fallback to estimated epoch
            epoch = {epoch: latestTx.epoch - 3600 * Math.abs(spanDay)} as Epoch
            console.log(`${__filename} epoch is null, estimate by latest tx, got `, epoch.epoch)
        }
        const list = await
            FullTransaction.findAll({
                attributes: [
                    [fn('sum',col('gas')), 'gas'],
                    'fromId',
                ],
                group: ['fromId'], raw: true,
                // logging: console.log,
                where: {
                    [Op.and]: [
                        {epoch: {[Op.gte]: epoch.epoch}},
                        {epoch: {[Op.lte]: endEpoch}},
                    ]
                },
                order: [[col('gas'),'desc']], limit: 10,
            });
        if (!list.length) {
            return emptyResult;
        }
        const sumGas = list.map(row=>BigInt(row['gas'])).reduce((a,b)=>a+b);
        const hexMap = await idHex40Map(list.map(row=>row['fromId']));
        list.forEach(row=>{
            row['hex'] = ethers.utils.getAddress(`0x${hexMap.get(row['fromId'])}`)
            row['base32'] = TxnQuery.base32(row['hex'], StatApp.networkId)
        })
        let result = {totalGas: sumGas, list, beginEpoch: epoch.epoch, endEpoch};
        writeCache(cachePath, result)
        return result
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
        await that.updateTopGasUsed(true).catch(err =>{
            console.log(`schedule top_gas_used error:${err}`)
        })
        async function repeat() {
            await that.updateTopGasUsed(false).catch(err =>{
                console.log(`schedule top_gas_used error:${err}`)
            })
            setTimeout(repeat, delay)
        }
        repeat().then()
    }
    public async updateTopGasUsed(forceUseCache = false) {
        // execute sql sequentially in order to reduce db load
        const d7 = await TxnQuery.topByGasUsed({span: '7d', forceUseCache})
        const d3 = await TxnQuery.topByGasUsed({span: '3d', forceUseCache})
        const h24 = await TxnQuery.topByGasUsed({span: '24h', forceUseCache})
        this.topGasUsedCache = {
            '7d': d7,
            '3d': d3,
            '24h': h24,
        };
        await statGasConsumer(new Date());
    }
}


async function statGasConsumer(dt: Date) {
    let [lastDay, lastHour] = await Promise.all([
      GasConsumer.findOne({where: {addrId: 0, statType: '1d'}, order:['statTime', 'desc'], raw: true}),
      GasConsumer.findOne({where: {addrId: 0, statType: '1h'}, order:['statTime', 'desc'], raw: true}).then(res=>res as IGasConsumer),
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
        while (movingHT.getTime() <= dt.getTime()) {
            const endT = new Date(movingHT);
            endT.setMinutes(59, 59, 999);
            const statArr = await sumGasUsed({beginTime: movingHT, endTime: endT});
            const beanArr = statArr.map(row => {
                return {addrId: row.fromId, gas: row.gas, statType: '1h', statTime: movingHT, endTime: endT} as IGasConsumer
            })
            await GasConsumer.bulkCreate(beanArr, {updateOnDuplicate: ['gas']});
            movingHT.setHours(movingHT.getHours()+1);
        }
        await GasConsumer.upsert({
            addrId: 0, statType: '1h', statTime: hourT,
        })
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
    while (movingDT.getTime() <= dt.getTime()) {
        const endT = new Date(movingDT);
        endT.setHours(23, 59, 59, 999);
        const sumList = await GasConsumer.findAll({
            attributes: [
                [fn('sum',col('gas')), 'gas'],
                'addrId',
            ],
            where: {
            statTime: {[Op.between]: [movingDT, endT]},
                statType: '1h',
        }});
        const beanArr = sumList.map(({gas, addrId})=>{
            return {addrId, gas, statTime: movingDT, statType: '1d', endTime: endT} as GasConsumer;
        })
        await GasConsumer.bulkCreate(beanArr, {updateOnDuplicate: ['gas']});
        movingDT.setDate(movingDT.getDate()+1);
    }
    await GasConsumer.upsert({
        addrId: 0, statType: '1d', statTime: hourT,
    })
}

async function sumGasUsed({beginTime, endTime}: {beginTime: Date, endTime:Date}) {
    return FullTransaction.findAll({
        attributes: [
            [fn('sum',col('gas')), 'gas'],
            'fromId',
        ],
        group: ['fromId'], raw: true,
        // logging: console.log,
        where: {
            createdAt: {[Op.between]: [ beginTime, endTime]},
        },
    });
}
