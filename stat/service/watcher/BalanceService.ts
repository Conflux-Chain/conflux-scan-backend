import {decodeUtf8} from "../tool/StringTool";

const lodash = require('lodash');
import {Balance} from "../../model/Balance";
import {Token, TOKEN_ERC_1155} from "../../model/Token";
import {Erc20WatchList} from "../../config/StatConfig";
import {getAddrId, Hex40Map, makeId, makeIdV} from "../../model/HexMap";
import {Contract} from "../../model/Contract";
// @ts-ignore
import {format} from "js-conflux-sdk";
import {BalanceWatcher} from "./BalanceWatcher";
import {Op, cast, col} from "sequelize";
import {ContractService} from "../contract/ContractService";
import {base32toVerbose} from "../tool/AddressTool";
const BigFixed = require('bigfixed');
import {StatApp} from "../../StatApp";
import {BatchBalanceWatcher} from "./BatchBalanceWatcher";
import {TokenQuery} from "../TokenQuery";

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
        const list = await Token.findAll({
            attributes: {exclude: ['icon']},
            where: {type: {[Op.ne]: ''}, name: {[Op.ne]: ''}, symbol: {[Op.ne]: ''},
                auditResult:true}
        })
        for (let i = 0; i < list.length; i++){
            let t = list[i];
            await this.updateToken(t)
        }
    }

    public async updateToken(tokenBean: Token) {
        //
        let table = BalanceWatcher.mapModel('', true, tokenBean.hex40id);
        let holder = await table.count()
        await tokenBean.update({holder: holder}, {where: {id: tokenBean.id}})
    }

    async rankHolder(base32: any, skip: any, limit: any) {
        const {
            app: { tokenTool },
        } = this;

        let token = await Token.findOne({where: {base32: base32}, attributes: {exclude: ['icon']}})
        if (token == null) {
            // return {total: 0, list:[], message: 'token not found '+base32, code: 404}
            // @ts-ignore
            token = {hex40id: await getAddrId(base32), symbol: ''}
        }
        let table = BalanceWatcher.mapModel('', true, token.hex40id);
        if (table == null) {
            return {total: 0, list:[], message: 'token not found '+base32, code: 6404}
        }
        const start = Date.now()
        const total = await table.count()
        if (total == 0) {
            return {total: 0, list:[], code: 0, table: table.getTableName()}
        }
        const list = await table.findAll({
            // max decimal 65 // https://dev.mysql.com/doc/refman/5.7/en/fixed-point-types.html
            order:[[cast(col("balance"), 'Decimal(60)'),"desc"]],
            offset: skip, limit
        })
        const elapsed = Date.now() - start;
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
                updatedAt: holder['updatedAt'],
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
            const page = await this.app.tokenQuery.list({addressArray: [...addressSet]});
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

        return {total, list: retList, code: 0, skip, limit, table: table.getTableName(), holderQuery:elapsed}
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

    static async listAccountBalance(base32: string) : Promise<any[]>{
        return this.listAccountBalanceInner(base32).then(res=>{
            return res.list
        })
    }
    static async listAccountBalanceInner(base32: string) :
        Promise<{ candidate?: number; list: any[]; message?: string }>{
        const hex = format.hexAddress(base32)
        if (hex === '0x0000000000000000000000000000000000000000') {
            return {list:[], message: 'Can not query for zero address.'}
        }
        const accountBean = await Hex40Map.findOne({where: {hex: hex.substr(2)}});
        if (accountBean === null) {
            return {list:[], message: 'account not found:'+hex}
        }
        const {balanceMap, tokenArray: tokenList} = await TokenQuery.listAccountTokens({accountAddress:base32});
        const contracts = tokenList.map(t=>t.base32);
        // fetch real time balance. 'incorrect' nft may return 0.
        const banList = await BatchBalanceWatcher.getBalances(base32, contracts)
        const resultList = []
        lodash.zip(tokenList, banList).forEach(
            ([token,ban], idx) => {
                // use db balance for nft only
                const fixBalance = ban || token['isNFT'] ? balanceMap[tokenList[idx]?.hex40id]?.balance : 0;
                fixBalance && resultList.push({
                    name: token.name,
                    decimals: token.decimals,
                    symbol: token.symbol,
                    base32: token.base32,
                    tokenHex40id: token.hex40id,
                    iconUrl: token.iconUrl,
                    type: token.type,
                    balance: fixBalance,
                })
            }
        )
        return {list:resultList, candidate: tokenList.length}
    }
    async getHolderCount(base32: string) : Promise<number> {
        const token = await Token.findOne({where: {base32: base32}})
        if (token == null) {
            return null
        }
        return token.holder
    }
}
