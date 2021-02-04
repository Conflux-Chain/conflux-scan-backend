import {TransactionDB, Transaction} from "../model/Transaction";
import {Hex40Map} from "../model/HexMap";
import {Op} from 'sequelize'
// @ts-ignore
import {format} from 'js-conflux-sdk'

export class TxnQuery{
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
            logging: console.log,
            benchmark: true
        })
        const hexIdMap = new Map<number, string>()
        hexArr.forEach(r=>{
            hexIdMap.set(r.id, r.hex)
        })
        page.rows.forEach(r=>{
            r['fromHex'] = hexIdMap.get(r.from) || ''
            r['fromBase32'] = this.base32(r['fromHex'], networkId)
            r.toHex = '0x'+(hexIdMap.get(r.to) || '')
            r['toBase32'] = this.base32(r.toHex, networkId)
        })
        return page;
    }

    base32(hex, networkId) {
        if (hex === null || hex === undefined || hex === '') {
            return ''
        }
        return format.address(hex, networkId)
    }
}