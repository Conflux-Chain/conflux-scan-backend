const lodash = require('lodash');
import {Balance} from "../../model/Balance";
import {Token, TOKEN_ERC_1155} from "../../model/Token";
import {Erc20WatchList} from "../../config/StatConfig";
import {Hex40Map, makeId} from "../../model/HexMap";
// @ts-ignore
import {format} from "js-conflux-sdk";
import {BalanceWatcher} from "./BalanceWatcher";
import {Op} from "sequelize";
import {ContractService} from "../contract/ContractService";
import {base32toVerbose} from "../tool/AddressTool";
const BigFixed = require('bigfixed');

export class BalanceService {
    private tokens: Erc20WatchList[];
    private readonly networkId: number;
    private tokenMap:Map<string, Erc20WatchList>

    constructor(erc20watchList: Erc20WatchList[], networkId:number = 1029) {
        this.tokens = erc20watchList
        this.networkId = networkId;
        this.tokenMap = new Map()
        erc20watchList.forEach(t=>{
            this.tokenMap.set(t.name, t)
        })
    }

    public async getERC1155balance(addr: string) {
        let fullHex = format.hexAddress(addr);
        const hex = fullHex.substr(2)
        const hexBean = await Hex40Map.findOne({where: {hex}})
        if (hexBean === null) {
            return {code: 0, list:[], message: 'address not found'}
        }
        const list1155 = await Token.findAll({where:{type:TOKEN_ERC_1155}})
        const banList = await Promise.all(list1155.map(token=>{
            const ret = {name: token.name, symbol: token.symbol, base32: token.base32, ms:0}
            let startMS = new Date().getTime()
            try {
                const watcher = BalanceWatcher.watcherMap.get(token.symbol)
                if (watcher === null) {
                    return {...ret, balance:NaN, message:'conf not found.'}
                }
                return watcher.queryBalanceErc1155(fullHex).then(list=>{
                    if (list === null) {
                        return {...ret, balance:NaN, message:'call contract return null.'}
                    }
                    return {...ret, balance: list.filter(n => n > 0).length, message: 'ok',
                        ms: (new Date().getTime() - startMS)}
                })
            } catch (e) {
                console.log(`fetch erc1155 balance fail:`,e)
                return {...ret, balance:NaN, message:`exception ${e}`}
            }
        }))
        return {list:banList, code:0, message: 'ok', tokenCounted: list1155.length}
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
        const hexBean = await makeId(token.address) //Hex40Map.findOne({where: {hex: token.address.substr(2)}})
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
        await tokenBean.update({holder: holder, type: token.tokenType}, {where: {id: tokenBean.id}})
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
        const is1155 = (token.type || '').includes('1155')
        const retList = list.map(holder=>{
            const addr = map.get(holder.addressId)
            const address = addr ? format.address(addr, this.networkId): holder.addressId
            // console.log(`balance type is : ${typeof  holder.balance}`)
            return {
                // holder.balance is string
                balance: is1155 ? holder.balance : this.decimal2drip(holder.balance, 18),
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
    async listAccountBalance(base32: string, tokenType: string) : Promise<any[]>{
        const hex = format.hexAddress(base32)
        const accountBean = await Hex40Map.findOne({where: {hex: hex.substr(2)}})
        if (accountBean === null) {
            return []
        }
        const tokenList = await Token.findAll({where: {type: tokenType}});
        const balanceList = await Promise.all(tokenList.map(async token=>{
            const model = BalanceWatcher.mapModel(token.symbol, true)
            if (model) {
                return model.findOne({where: {addressId: accountBean.id}})
            }
            return {balance: 0}
        }))
        const resultList = []
        lodash.zip(tokenList, balanceList).forEach(
            ([token,balanceBean], idx) => {
                if (token.type.toUpperCase() === 'ERC721') {
                    balanceBean.balance = this.decimal2drip(balanceBean.balance, 18)
                }
                balanceBean.balance && resultList.push({
                    name: token.name,
                    symbol: token.symbol,
                    base32: token.base32,
                    tokenHex40id: token.hex40id,
                    icon: token.icon,
                    type: token.type,
                    balance: balanceBean.balance,
                    addressId: balanceBean.addressId,
                    updatedAt: balanceBean.updatedAt
                })
            }
        )
        return resultList
    }
    async getHolderCount(base32: string) : Promise<number> {
        const token = await Token.findOne({where: {base32: base32}})
        if (token == null) {
            return null
        }
        return token.holder
    }
}