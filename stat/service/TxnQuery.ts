import {Transaction, TransactionDB} from "../model/Transaction";
import {Hex40Map, idHex40Map} from "../model/HexMap";
import {QueryTypes, Op, Sequelize, fn, col} from 'sequelize'
// @ts-ignore
import {format} from 'js-conflux-sdk'
import {StatApp} from "../StatApp";
import {DailyTransaction} from "../model/DailyTransaction";
import {FullTransaction} from "../model/FullBlock";

export class TxnQuery{
    static async txnCountByTime({span = '24h'}) : Promise<number> {
        const def = {'24h': -1, '3d': -3, '7d': -7}
        let spanDay = def[span];
        return TransactionDB.count({
            where: { 'blockTime': {[Op.gt]: fn('addtime', fn('now'), `${spanDay} 0:0:0`)}
                , status: 0},
            // benchmark: true, logging: console.log
        })
    }
    static async gasUsedSum(days:number) : Promise<{txCount, gasFee}> {
        const sum = await DailyTransaction.findOne({
            attributes: [
                [fn('sum', col('txCount')),'txCount'],
                [fn('sum', col('gasFee')),'gasFee'],
            ],
            where: {
                statDay: {[Op.gt]: fn('addtime', fn('now'), `${days} 0:0:0`),}
            },
            logging: console.log,
        })
        return sum;
    }
    static async topByGasUsed({span = '24h'}, seq:Sequelize) {
        const def = {'24h': -1, '3d': -3, '7d': -7}
        let spanDay = def[span];
        if (spanDay === undefined) {
            return {code: 610, message: `unknown span [${span}], support ${Object.keys(def).join(',')}`}
        }
        const list = await
            FullTransaction.findAll({
                attributes: [
                    [fn('sum',col('gas')), 'gas'],
                    'fromId',
                ],
                group: ['fromId'], raw: true,
                logging: console.log,
                where: {status: 0,
                    createdAt: {[Op.gte]: fn('addtime', fn('now'), `${spanDay} 0:0:0`)}
                },
                order: [[col('gas'),'desc']],
            });
        if (!list.length) {
            return {code: 0, totalGas: 0, list:[]};
        }
        const sumGas = list.map(row=>BigInt(row['gas'])).reduce((a,b)=>a+b);
        const hexMap = await idHex40Map(list.map(row=>row['fromId']));
        // const sql = `select sum(gas) as gas, \`from\` as fromId, hex
        //         from tx left join hex40 on tx.\`from\` = hex40.id
        //         where blockTime > addtime(now(), '${spanDay} 0:0:0') and status=0 group by \`from\`
        //         order by gas desc limit 10`
        // const list:any[] = await seq.query(sql, {type: QueryTypes.SELECT})
        // const sum = await TransactionDB.sum('gas',{
        //     where: { 'blockTime': {[Op.gt]: fn('addtime', fn('now'), `${spanDay} 0:0:0`)}
        //         , status: 0},
        //     // benchmark: true, logging: console.log
        // })
        // const maxBlockTime = await TransactionDB.max('blockTime')
        list.forEach(row=>{
            row['hex'] = `0x${hexMap.get(row['fromId'])}`
            row['base32'] = TxnQuery.base32(row['hex'], StatApp.networkId)
        })
        return { code: 0, totalGas: sumGas, list}
    }
    async listTxn(condition: Transaction, skip: number = 0, limit: number = 10, networkId: number = 1029) {
        const query: {from?: number} = {}
        if (condition.from) {
            const fromBean = await Hex40Map.findOne({where: {hex: condition.from.substr(2)}})
            query.from = fromBean?.id
        }
        const page = await TransactionDB.findAndCountAll({
            where: query, offset: skip, limit, order:[["id", "DESC"]]
        })
        const hexIdSet = new Set<number>()
        page.rows.forEach(r=>{
            hexIdSet.add(r.from)
            hexIdSet.add(r.to)
        })
        const hexArr = await Hex40Map.findAll({
            where: {
                id: { [Op.in]: Array.from(hexIdSet)}
            },
            // logging: console.log,
            benchmark: true
        })
        const hexIdMap = new Map<number, string>()
        hexArr.forEach(r=>{
            hexIdMap.set(r.id, r.hex)
        })
        page.rows.forEach(r=>{
            r['fromHex'] = hexIdMap.get(r.from) || ''
            r['fromBase32'] = TxnQuery.base32(r['fromHex'], networkId)
            r.toHex = '0x'+(hexIdMap.get(r.to) || '')
            r['toBase32'] = TxnQuery.base32(r.toHex, networkId)
        })
        return page;
    }

    static base32(hex, networkId) {
        if (hex === null || hex === undefined || hex === '') {
            return ''
        }
        return format.address(hex, networkId)
    }
}