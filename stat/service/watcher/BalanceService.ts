import {Balance} from "../../model/Balance";
import {Token} from "../../model/Token";
import {Erc20WatchList} from "../../config/StatConfig";
import {Hex40Map} from "../../model/HexMap";
// @ts-ignore
import {format} from "js-conflux-sdk";
import {BalanceWatcher} from "./BalanceWatcher";
import {Op} from "sequelize";
import {ContractService} from "../contract/ContractService";
const BigFixed = require('bigfixed');

export class BalanceService {
    private tokens: Erc20WatchList[];
    private readonly networkId: number;

    constructor(erc20watchList: Erc20WatchList[], networkId:number = 1029) {
        this.tokens = erc20watchList
        this.networkId = networkId;
    }

    public async listToken() {
        const list = await Token.findAll({})
        return list;
    }

    public schedule(delay: number = 60_000) {
        const that = this
        async function repeat() {
            await that.run()
            setTimeout(repeat, delay)
        }
        repeat().then()
    }

    async run() {
        this.tokens.forEach(t=>{
            this.updateToken(t)
        })
    }

    public async updateToken(token: Erc20WatchList) {
        const hexBean = await Hex40Map.findOne({where: {hex: token.address.substr(2)}})
        if (hexBean == null) {
            console.log(`token address not found in hex map: ${token.name}, ${token.address}`)
            return;
        }
        let tokenBean:Token = await Token.findOne({where: {hex40id: hexBean.id}});
        if (tokenBean == null) {
            tokenBean = await Token.create({
                base32: format.address(token.address, this.networkId),
                hex40id: hexBean.id, holder: 0,
                symbol: token.name
            })
        }
        //
        let table: typeof Balance;
        try {
            table = BalanceWatcher.mapModel(token.name);
        } catch (err) {
            console.log(`table not found for ${token.name}`)
            return;
        }
        let holder = await table.count({})
        await tokenBean.update({holder: holder}, {where: {id: tokenBean.id}})
    }

    async rankHolder(base32: any, skip: any, limit: any) {
        const token = await Token.findOne({where: {base32: base32}})
        if (token == null) {
            return {total: 0, list:[], message: 'token not found '+base32, code: 404}
        }
        let table = BalanceWatcher.mapModel(token.symbol);
        if (table == null) {
            return {total: 0, list:[], message: 'token not found '+base32, code: 6404}
        }
        const total = await table.count({where:{}})
        if (total == 0) {
            return {total: 0, list:[], code: 0, table: table.getTableName()}
        }
        const list = await table.findAll({order:[["balance","desc"]], offset: skip, limit})
        const hexList = await Hex40Map.findAll({where: {id: {[Op.in]:list.map(h=>h.addressId)}}})
        const map = new Map()
        hexList.forEach(hex=>map.set(hex.id, `0x${hex.hex}`))
        const retList = list.map(holder=>{
            const addr = map.get(holder.addressId)
            const address = addr ? format.address(addr, this.networkId, true): holder.addressId
            return {
                balance: this.decimal2drip(holder.balance, 18),
                account: {
                    address,
                    name: addr ? ContractService.instance.getName(address) : undefined,
                },
                hexId: holder.addressId,
                // addr,
            }
        })
        return {total, list: retList, code: 0, skip, limit, table: table.getTableName()}
    }
    zeros = '00000000000000000000000'
    decimal2drip(d:any, fraction:number) {
        const arr = d.toString().split('.')
        if (arr.length === 1) {
            return d
        }
        let ret = `${arr[0]}${arr[1]}${this.zeros.substr(0,fraction-arr[1].length)}`.replace(/^0*/, '')
        if (ret.length === 0) {
            return '0'
        }
        return ret;
    }

    async getHolderCount(base32: string) : Promise<number> {
        const token = await Token.findOne({where: {base32: base32}})
        if (token == null) {
            return null
        }
        return token.holder
    }
}