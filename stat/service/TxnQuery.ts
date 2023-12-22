import {idHex40Map} from "../model/HexMap";
import {Op, fn, col} from 'sequelize'
// @ts-ignore
import {format} from 'js-conflux-sdk'
import {StatApp} from "../StatApp";
import {DailyTransaction} from "../model/DailyTransaction";
import {FullTransaction} from "../model/FullBlock";
import {Errors} from "./common/LogicError";
import {Epoch} from "../model/Epoch";
import * as fs from "fs";
import {loadCache, PATH_TOP_BY_GAS, resolveDockerPath, writeCache} from "./CacheService";

export class TxnQuery{
    static cacheFilePrefix = PATH_TOP_BY_GAS;
    static async gasUsedSum(days:number) : Promise<{txCount, gasFee}> {
        const sum = await DailyTransaction.findOne({
            attributes: [
                [fn('sum', col('txCount')),'txCount'],
                [fn('sum', col('gasFee')),'gasFee'],
            ],
            where: {
                statDay: {[Op.gt]: fn('addtime', fn('now'), `${days} 0:0:0`),}
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
        minTime.setDate(minTime.getDate() + spanDay);
        let epoch = await Epoch.findOne({
            where: {timestamp: {[Op.gte]: minTime}},
            order: [['timestamp', 'ASC']],
        });
        if (epoch === null) {
            // fallback to estimated epoch
            const latestTx = await FullTransaction.findOne({order: [['epoch', 'desc']]})
            if (latestTx === null) {
                return  emptyResult;
            }
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
                where: {status: 0,
                    epoch: {[Op.gte]: epoch.epoch}
                },
                order: [[col('gas'),'desc']], limit: 10,
            });
        if (!list.length) {
            return emptyResult;
        }
        const sumGas = list.map(row=>BigInt(row['gas'])).reduce((a,b)=>a+b);
        const hexMap = await idHex40Map(list.map(row=>row['fromId']));
        list.forEach(row=>{
            row['hex'] = `0x${hexMap.get(row['fromId'])}`
            row['base32'] = TxnQuery.base32(row['hex'], StatApp.networkId)
        })
        let result = {/*code: 0,*/ totalGas: sumGas, list};
        writeCache(cachePath, result)
        return result
    }

    static base32(hex, networkId) {
        if (hex === null || hex === undefined || hex === '') {
            return ''
        }
        return format.address(hex, networkId)
    }
}
