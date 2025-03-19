
const lodash = require('lodash');
import {Token} from "../../model/Token";
import {getAddrId, Hex40Map, makeId, makeIdV} from "../../model/HexMap";
// @ts-ignore
import {format} from "js-conflux-sdk";
import {BalanceWatcher} from "./BalanceWatcher";
import {Op, cast, col} from "sequelize";
import {fmtAddr, StatApp} from "../../StatApp";
import {BatchBalanceWatcher} from "./BatchBalanceWatcher";
import {TokenQuery} from "../TokenQuery";
import {Errors} from "../common/LogicError";
import {formatPrice} from "../common/utils";
import {patchSum1155amount} from "./Erc1155DataSync";
import {ethers} from "ethers";

export class BalanceService {
    private app: StatApp;
    private readonly networkId: number;

    constructor(app, networkId:number = 1029) {
        this.app = app;
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
        const list = await Token.findAll({
            attributes: {exclude: ['icon']},
            where: {type: {[Op.ne]: ''}, name: {[Op.ne]: ''}}
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
            /*return {total: 0, list:[], message: 'token not found '+base32, code: 6404}*/
            throw new Errors.ParameterError(`token ${base32} not found`);
        }
        const start = Date.now()
        const total = await table.count()
        if (total == 0) {
            return {total: 0, list:[], /*code: 0,*/ table: table.getTableName()}
        }
        const list = await table.findAll({
            // max decimal 65 // https://dev.mysql.com/doc/refman/5.7/en/fixed-point-types.html
            order:[[cast(col("balance"), 'Decimal(60)'),"desc"], ["updatedAt", "desc"], ["addressId", "asc"]],
            offset: skip, limit
        })
        list.forEach(e=>e.balance = scientificToBigInt(e.balance))
        const elapsed = Date.now() - start;
        const hexList = await Hex40Map.findAll({where: {id: {[Op.in]:list.map(h=>h.addressId)}}})
        const map = new Map()
        hexList.forEach(hex=>map.set(hex.id, `0x${hex.hex}`))
        const is1155 = (token.type || '').includes('1155')

        const retList = list.map(holder=>{
            const addr = map.get(holder.addressId)
            const address = addr ? fmtAddr(addr, this.networkId): holder.addressId
            // console.log(`balance type is : ${typeof  holder.balance}`)
            return {
                // holder.balance is string
                balance: is1155 ? holder.balance : this.decimal2drip(holder.balance, 18),
                account: {
                    address,
                    name: null, //doesn't work
                },
                hexId: holder.addressId,
                updatedAt: holder['updatedAt'],
                // addr,
            };
        })

        // add token info
        const addressArray = retList.map(item => item.account.address);
        const accountBasic = await this.app.accountQuery.listPatchInfo(addressArray);
        retList.forEach((item) => {
            item['tokenInfo'] = accountBasic.map[item.account.address]?.token;
            item['contractInfo'] = accountBasic.map[item.account.address]?.contract;
            item['ensInfo'] = accountBasic.map[item.account.address]?.ens;
            item['nameTagInfo'] = accountBasic.map[item.account.address]?.nameTag;
        });

        return {total, list: retList, skip, limit, table: table.getTableName(), holderQuery:elapsed, accountBasic}
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
    static async listAccountBalanceInner(base32: string, tokenType = []) :
        Promise<{ candidate?: number; list: any[]; message?: string }>{
        const hex = format.hexAddress(base32)
        if (hex === '0x0000000000000000000000000000000000000000') {
            throw new Errors.ParameterError(`Can not query for zero address.`);
        }
        const accountBean = await Hex40Map.findOne({where: {hex: hex.substr(2)}});
        if (accountBean === null) {
            throw new Errors.ParameterError(`Account ${base32} not found.`);
        }
        let {balanceMap, tokenArray: tokenList} = await TokenQuery.listAccountTokens({accountAddress:base32});
        if(tokenType?.length) {
            tokenType = tokenType.map(type => type.replace('CRC', 'ERC'))
            tokenList = tokenList.filter(token => lodash.includes(tokenType, token.type))
        }
        const contracts = tokenList.map(t=>t.base32);
        // fetch real time balance. 'incorrect' nft may return 0.
        const [banList] = await Promise.all([
            BatchBalanceWatcher.getBalances(base32, contracts),
            patchSum1155amount(tokenList, accountBean.id),
        ])
        const resultList = []
        lodash.zip(tokenList, banList).forEach(
            ([token,ban], idx) => {
                const sumAmount = token['sumAmount']
                // use db balance for nft only
                const balance = ban || token['isNFT'] ? balanceMap[tokenList[idx]?.hex40id]?.balance : 0;
                const priceInUSDT = token.price ? formatPrice(token.price.toString()) : undefined;
                balance && resultList.push({
                    name: token.name,
                    decimals: token.decimals,
                    symbol: token.symbol,
                    base32: token.base32,
                    tokenHex40id: token.hex40id,
                    iconUrl: token.iconUrl,
                    type: token.type,
                    balance,
                    sumAmount,
                    priceInUSDT,
                    quoteUrl: token.quoteUrl || undefined,
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

export function scientificToBigInt(v: string | number | undefined | null | bigint) : bigint {
    if (! (typeof v === 'string')) {
        return v as bigint; // cast for ts check
    }
    const [v0, e] = v.split('e')
    if (!e) {
        return v as unknown as bigint; // cast for ts check
    }
    return ethers.utils.parseUnits(v0, parseInt(e)).toBigInt()
}
