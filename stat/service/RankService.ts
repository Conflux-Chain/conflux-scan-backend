import {STATE_OK, T_TOP_BATCH_INDEX, T_TOP_RECORD, TopBatchIndex, TopRecord} from "../model/TopRecord";
import {Sequelize, QueryTypes, or} from "sequelize";
import {pickNumber} from "../model/Utils";
import {ADDR_INFO_STATE_OK, buildHexSet, Hex64Map, T_ADDRESS, T_ADDRESS_INFO} from "../model/HexMap";
// @ts-ignore
import {format} from 'js-conflux-sdk'
import {ContractService} from "./contract/ContractService";
import {StatApp} from "../StatApp";
import {CfxBalance} from "../model/Balance";
import {Op} from "sequelize"
import {AddressTransactionIndex} from "../model/FullBlock";
import {init} from "./tool/FixDailyTokenStat";

export class RankService{
    private app: StatApp;
    txnMap = new Map<number, any>()
    constructor(app) {
        this.app = app;
        this.updateTxnCache()
    }

    updateTxnCache() {
        const cnt = 100
        this.rankCfxBalance('total', cnt, true).then(()=>{
            return this.rankCfxBalance('stakingBalance', cnt , true)
        }).then(()=>{
            return this.rankCfxBalance('balance', cnt , true)
        }).then(()=>{
            setTimeout(()=>this.updateTxnCache(), 1000*3600)
        })
    }
    async rankCfxBalance(order:string, limit, updateTxnCache=false) {
        const sql = ` 
            select h.hex, addressId, balance as valueN, stakingBalance as value2, total as value3 from
            (select * from cfx_balance order by ? desc limit ?) b
            left join hex40 h on h.id = b.addressId
            left join address_info ai on ai.id = h.id
        `
        const list = await CfxBalance.sequelize.query(sql, {type: QueryTypes.SELECT, replacements:[order, limit]})
        if (updateTxnCache) {
            const hexIdSet = buildHexSet(undefined, list, 'addressId')
            // txn count
            const hexIdArr = [...hexIdSet]
            const placeHolder = hexIdArr.map(i => '?').join(',')
            const txnSql = `select count(*) as cnt, addressId from address_tx  where addressId in (${placeHolder}) group by addressId`

            await AddressTransactionIndex.sequelize.query(txnSql, {
                type: QueryTypes.SELECT,
                replacements: hexIdArr
            }).then(arr => {
                arr.forEach(b => this.txnMap.set(b['addressId'], b))
            })
        } else {
            list.forEach(r => r['value4'] = this.txnMap.get(r['addressId'])?.cnt || 0)
        }
        return list
    }
    async rankByCfx(order:string, limit, networkId) {
        const list = await this.rankCfxBalance(order, limit)
        list.forEach((b,idx)=>b['rank'] = idx+1)
        return this.fillInfo(list, networkId)
    }
    async top(type: string, limit: number = 10, networkId: number = 1029) : Promise<any> {
        if (type === 'rank_address_by_total_cfx') {
            return this.rankByCfx('total', limit, networkId)
        } else if (type === 'rank_address_by_cfx') {
            return this.rankByCfx('balance', limit, networkId)}
        else if (type === 'rank_address_by_staking') {
            return this.rankByCfx('stakingBalance', limit, networkId)
        }
        limit = pickNumber(limit, 10)
        const newLine = ''
        const maxBatchId: number = await TopBatchIndex.max('id',
            {where: {type: type, state: STATE_OK}})
        if (isNaN(maxBatchId)) {
            console.log(`max batch id not found. type ${type}`)
            return Promise.resolve({code: 501, list: [], total: 0, message: 'no data'})
        }
        const t_addr = T_ADDRESS
        const sql = `select hex40 as hex, \`value\` as valueN, valueDesc, ${newLine
        }value2, value2desc, value3, value3desc, value4, value4desc, \`percent\`, \`rank\`, ${T_ADDRESS_INFO}.name, ${T_ADDRESS_INFO}.state as nameState, ${newLine
        } begin_time, end_time from ${T_TOP_RECORD
        } JOIN ${T_TOP_BATCH_INDEX
        } ON batch_id=\`${T_TOP_BATCH_INDEX}\`.id left join ${t_addr} on ${t_addr}.id = address_id ${
            newLine} left join ${T_ADDRESS_INFO} on ${t_addr}.id = ${T_ADDRESS_INFO}.id ${newLine
        } where batch_id=? order by \`rank\` limit ?`;
        // console.log(`sql is : ${sql}`)
        const list: any[] = await this.app.sequelize.query(sql, {
            replacements: [maxBatchId, limit],
            type: QueryTypes.SELECT,
            benchmark: true, logging: console.log
        })
        return this.fillInfo(list, networkId)
    }
    async fillInfo(list:any[], networkId) {
        const {
            app: {tokenTool},
        } = this;
        const addressSet = new Set<string>();
        list.forEach(r=>{
            r.name = r.nameState === ADDR_INFO_STATE_OK ? r.name : null
            r.hex = `0x${r.hex}`
            r.base32address = format.address(r.hex, networkId)
            if(!r.name){
                r.name = ContractService.instance.getName(r.base32address)
            }
            if(!r.name &&  format.hexAddress(r.base32address).startsWith('0x8')){
                addressSet.add(r.base32address);
            }
        })

        // add token info if contract name no exists
        const tokenInfoMap = new Map();
        if(addressSet.size > 0){
            const page = await this.app.tokenQuery.list([...addressSet], ['icon']);
            page?.list?.forEach(token => {
                tokenInfoMap.set(token.address, {name: token.name, symbol: token.symbol, icon: token.icon});
            });
        }
        await Promise.all( list.map( async r=>{
            if(!r.name){
                r.tokenInfo = tokenInfoMap.get(r.base32address) || {};
            }
            if(!r.name && !r.tokenInfo.name){
                const tokenInfo = await tokenTool.getToken(r.base32address);
                r.tokenInfo = {name: tokenInfo.name, symbol: tokenInfo.symbol} || {};
            }
        }))

        return {code: 0, total: list.length, list};
    }
}

if (require.main === module) {
    init().then(()=>{
        return new RankService({}).rankCfxBalance('total', 100)
    }).then(list=>{
        const str = list.map(r=>`${r["addressId"]}, ${r['hex']}, ${r['valueN']}, ${r['value4']}`).join('\n')
        console.log(`${str}`)
    })
}