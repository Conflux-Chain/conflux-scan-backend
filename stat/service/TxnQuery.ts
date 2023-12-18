import {Hex40Map, idHex40Map} from "../model/HexMap";
import {QueryTypes, Op, Sequelize, fn, col} from 'sequelize'
// @ts-ignore
import {format} from 'js-conflux-sdk'
import {StatApp} from "../StatApp";
import {DailyTransaction} from "../model/DailyTransaction";
import {FullTransaction} from "../model/FullBlock";
import {Errors} from "./common/LogicError";
import {Epoch} from "../model/Epoch";

export class TxnQuery{
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
    static async topByGasUsed({span = '24h'}) {
        const def = {'24h': -1, '3d': -3, '7d': -7}
        let spanDay = def[span];
        if (spanDay === undefined) {
            /*return {code: 610, message: `unknown span [${span}], support ${Object.keys(def).join(',')}`}*/
            throw new Errors.ParameterError(`unknown span [${span}], support ${Object.keys(def).join(',')}`);
        }

        // convert createAt to epoch
        const minTime = new Date();
        minTime.setDate(minTime.getDate() + spanDay);
        const epoch = await Epoch.findOne({
            where: {timestamp: {[Op.gte]: minTime}},
            order: [['timestamp', 'ASC']],
        });

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
            return {/*code: 0,*/ totalGas: 0, list:[]};
        }
        const sumGas = list.map(row=>BigInt(row['gas'])).reduce((a,b)=>a+b);
        const hexMap = await idHex40Map(list.map(row=>row['fromId']));
        list.forEach(row=>{
            row['hex'] = `0x${hexMap.get(row['fromId'])}`
            row['base32'] = TxnQuery.base32(row['hex'], StatApp.networkId)
        })
        return {/*code: 0,*/ totalGas: sumGas, list}
    }

    static base32(hex, networkId) {
        if (hex === null || hex === undefined || hex === '') {
            return ''
        }
        return format.address(hex, networkId)
    }
}