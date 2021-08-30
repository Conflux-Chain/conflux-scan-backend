import {decodeUtf8} from "../tool/StringTool";

const lodash = require('lodash');
import {Balance} from "../../model/Balance";
import {Token, TOKEN_ERC_1155} from "../../model/Token";
import {Erc20WatchList} from "../../config/StatConfig";
import {Hex40Map, makeId} from "../../model/HexMap";
import {Contract} from "../../model/Contract";
// @ts-ignore
import {format} from "js-conflux-sdk";
import {BalanceWatcher} from "./BalanceWatcher";
import {Op} from "sequelize";
import {ContractService} from "../contract/ContractService";
import {base32toVerbose} from "../tool/AddressTool";
const BigFixed = require('bigfixed');
import {StatApp} from "../../StatApp";
import {BatchBalanceWatcher} from "./BatchBalanceWatcher";

export class BalanceService {
    private app: StatApp;
    private tokens: Erc20WatchList[];
    private readonly networkId: number;
    private tokenMap:Map<string, Erc20WatchList>

    constructor(app, erc20watchList: Erc20WatchList[], networkId:number = 1029) {
        this.app = app;
        this.tokens = erc20watchList;
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
        const confIds = [-1]
        const tasks = []
        this.tokens.forEach(t=>{
            tasks.push(
                this.updateTokenByConf(t).then(res=>{
                    if (res) {
                        confIds.push(res.id)
                    }
                })
            )
        })
        await Promise.all(tasks)
        const list = await Token.findAll({
            where: {type: {[Op.ne]: ''}, name: {[Op.ne]: ''}, symbol: {[Op.ne]: ''},
                // skip configured token.
                id: {[Op.notIn]: confIds}}
        })
        for (let i = 0; i < list.length; i++){
            let t = list[i];
            await this.updateToken(t)
        }
    }

    public async updateToken(tokenBean: Token) {
        //
        let table = BalanceWatcher.mapModel('', true, tokenBean.hex40id);
        let holder = await table.count({})
        await tokenBean.update({holder: holder}, {where: {id: tokenBean.id}})
    }
    public async updateTokenByConf(token: Erc20WatchList) {
        const hexBean = await makeId(token.address) //Hex40Map.findOne({where: {hex: token.address.substr(2)}})
        let tokenBean:Token = await Token.findOne({where: {hex40id: hexBean.id}});
        if (tokenBean == null) {
            return
        }
        //
        let table: typeof Balance;
        try {
            table = BalanceWatcher.mapModel(token.name, false, tokenBean.hex40id);
        } catch (err) {
            console.log(`table not found for ${token.name}`)
            return;
        }
        let holder = await table.count({})
        await tokenBean.update({holder: holder}, {where: {id: tokenBean.id}})
        return tokenBean
    }
    async rankHolder(base32: any, skip: any, limit: any) {
        const {
            app: { tokenTool },
        } = this;

        const token = await Token.findOne({where: {base32: base32}})
        if (token == null) {
            return {total: 0, list:[], message: 'token not found '+base32, code: 404}
        }
        let table = BalanceWatcher.mapModel(token.symbol, true, token.hex40id);
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
            };
        })

        // add token info if contract name no exists
        const addressSet = new Set<string>();
        retList.forEach(item => {
            if(!item.account.name &&  format.hexAddress(item.account.address).startsWith('0x8')){
                addressSet.add(item.account.address);
            }
        });
        const tokenInfoMap = new Map();
        if(addressSet.size > 0){
            const page = await this.app.tokenQuery.list([...addressSet], ['icon']);
            page?.list?.forEach(token => {
                tokenInfoMap.set(token.address, {name: token.name, symbol: token.symbol, icon: token.icon});
            });
        }
        for(const item of retList){
            if(!item.account.name){
                item['tokenInfo'] = tokenInfoMap.get(item.account.address) || {};
            }
            if(!item.account.name && !item['tokenInfo']['name']){
                const tokenInfo = await tokenTool.getToken(item.account.address);
                item['tokenInfo'] = {name: tokenInfo.name, symbol: tokenInfo.symbol} || {};
            }
        }

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
        const tokenList = await Token.findAll({where: {type: tokenType, fetchBalance: true}});
        const contracts = tokenList.map(t=>t.base32);
        const banList = await BatchBalanceWatcher.getBalances(base32, contracts)
        const resultList = []
        lodash.zip(tokenList, banList).forEach(
            ([token,ban], idx) => {
                let upperCase = token.type.toUpperCase();
                if (upperCase !== 'ERC721' || upperCase !== 'ERC1155') {
                    ban = Number(ban) / Number(token.decimals || 18)
                }
                ban && resultList.push({
                    name: token.name,
                    symbol: token.symbol,
                    base32: token.base32,
                    tokenHex40id: token.hex40id,
                    icon: token.icon ? decodeUtf8(token.icon) : token.icon,
                    type: token.type,
                    balance: ban,
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
