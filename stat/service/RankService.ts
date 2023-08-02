import {STATE_OK, T_TOP_BATCH_INDEX, T_TOP_RECORD, TopBatchIndex, TopRecord} from "../model/TopRecord";
import {Sequelize, QueryTypes, or} from "sequelize";
import {pickNumber} from "../model/Utils";
import {
    ADDR_INFO_STATE_OK,
    buildHexSet,
    fillHexId,
    Hex64Map,
    idHex40Map, mapProp,
    T_ADDRESS,
    T_ADDRESS_INFO
} from "../model/HexMap";
// @ts-ignore
import {format} from 'js-conflux-sdk'
import {StatApp} from "../StatApp";
import {CfxBalance} from "../model/Balance";
import {Op} from "sequelize"
import {AddressTransactionIndex} from "../model/FullBlock";
import {init} from "./tool/FixDailyTokenStat";
import {DailyToken} from "../model/Token";
import {PruneInfo} from "../model/PruneInfo";
import {topUnique} from "./UniqueAddressStat";
import {IS_EVM, KV} from "../model/KV";
import {Errors} from "./common/LogicError";

export class RankService{
    private app: any;
    txnMap = new Map<number, any>()
    constructor(app) {
        this.app = app;
        this.updateTxnCache()
    }

    updateTxnCache() {
        // update unique addr cache.
        ['senders','receivers','participants'].forEach(which=>{
            [1,3,7].forEach(day=>{
                this.rankTokenUniqueAddr({day, which}).catch(err=>{
                    console.log(` update token unique addr fail.`, err)
                })
            })
        })
        //
        const cnt = 100
        this.rankCfxBalance('total', cnt, true).then(()=>{
            return this.rankCfxBalance('stakingBalance', cnt , true)
        }).then(()=>{
            return this.rankCfxBalance('balance', cnt , true)
        }).then(()=>{
            setTimeout(()=>this.updateTxnCache(), 1000*3600)
        })
    }
    /*
     select h.hex, addressId, balance as value2, stakingBalance as value3, total as value4 from
(select * from cfx_balance order by total desc limit 100) b
         left join hex40 h on h.id = b.addressId
           left join address_info ai on ai.id = h.id;
     */
    async rankCfxBalance(order:string, limit, updateTxnCache=false) {
        const sql = ` 
            select h.hex, addressId, ${order}, balance as value2, stakingBalance as value3, total as value4 from
            (select * from cfx_balance where ${order} > 1 order by ${order} desc, cfx_balance.addressId asc limit ?) b
            left join hex40 h on h.id = b.addressId
            left join address_info ai on ai.id = h.id
        `
        const list = await CfxBalance.sequelize.query(sql, {type: QueryTypes.SELECT, replacements:[limit],
            // logging: console.log, benchmark: true,
        })
        if (updateTxnCache) {
            const hexIdSet = buildHexSet(undefined, list, 'addressId')
            if (hexIdSet.size === 0) {
                hexIdSet.add("-1");
            }
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
            const addressIdArray = list.map(item => item['addressId']) || [];
            const prunedMap = await this.getPrunedTxCount(addressIdArray);
            // add pruned tx count
            list.forEach(r => r['valueN'] = (this.txnMap.get(r['addressId'])?.cnt || 0) + (prunedMap[r['addressId']] || 0))
        }
        return list
    }

    async getPrunedTxCount(addressIdArray){
        const prunedMap = {};
        if(!addressIdArray?.length) return prunedMap;

        const list = await PruneInfo.findAll({
            where: {
                addressId: {[Op.in]: addressIdArray},
                type: 'AD_TX'
            }
        })

        list?.forEach(pruneInfo => {
            prunedMap[pruneInfo['addressId']] = pruneInfo['pruned'];
        });
        return prunedMap;
    }

    tokenUniqueArrCache = {} // 1 3 7 day
    async rankTokenUniqueAddr({day = 7, which = 'participants'}) {
        let cached = this.tokenUniqueArrCache[day];
        if (cached) {
            return cached[which]
        }
        const {maxTimeStart, list, timeBegin} = await topUnique({limit: 10, day})
        const [senders, receivers, participants] = await Promise.all(
            ['sender','receiver','all'].map(k=>{
                return this.buildUniqueAddrTop(list[k], k).then(res=>{
                    res["maxTimeStart"] = maxTimeStart
                    return res;
                })
            })
        )
        cached = this.tokenUniqueArrCache[day] = {maxTimeStart, timeBegin, senders, receivers, participants}
        return cached[which]
    }
    async buildUniqueAddrTop(arr:any[], prop:string) {
        const contractIdSet = buildHexSet(undefined, arr, 'contractId')
        const idHexMap = await idHex40Map([...contractIdSet])
        mapProp(idHexMap, arr, 'contractId', 'hex')
        function copyProp(arr:any[], from:string, to:string) {
            arr.forEach(r=>r[to] = r[from])
        }
        copyProp(arr, prop, 'valueN')
        const netId = StatApp.networkId;
        return this.fillInfo(arr, netId);
    }

    // 9999895641981116/5000000000000000*2
    async rankByCfx(order:string, limit, networkId) {
        const list = await this.rankCfxBalance(order, limit)
        const isEvm = await KV.getString(IS_EVM, '')
        const totalCfx = isEvm ? (await CfxBalance.sum('balance')) :
            networkId === 1029 ? 50_0000_0000 : 5000000000000000*2
        list.forEach((b,idx)=>{
            b['rank'] = idx+1
            b['percent'] = b[order] / totalCfx * 100
        })
        return this.fillInfo(list, networkId)
    }
    async rankByToken(table, field, span, limit, networkId) {
        const startDate = new Date()
        startDate.setHours(0,0,0,0)
        startDate.setDate(startDate.getDate() - span)
        const sql = `select valueN, h.hex from (select sum(${field}) as valueN,hexId from ${table} where day >= ? group by hexId order by valueN desc limit ?) b
        left join hex40 h on h.id = b.hexId`
        const list = await DailyToken.sequelize.query(sql, {type:QueryTypes.SELECT, replacements:[startDate, limit]})
        return this.fillInfo(list, networkId)
    }
    async top(type: string, limit: number = 10, networkId: number = 1029) : Promise<any> {
        if (type === 'rank_address_by_total_cfx') {
            return this.rankByCfx('total', limit, networkId)
        } else if (type === 'rank_address_by_cfx') {
            return this.rankByCfx('balance', limit, networkId)
        } else if (type === 'rank_address_by_staking') {
            return this.rankByCfx('stakingBalance', limit, networkId)
        } else if (type === 'rank_contract_by_number_of_transfers_7d') {
            return this.rankByToken('daily_token','transferCount', 7, limit, networkId)
        } else if (type === 'rank_contract_by_number_of_transfers_3d') {
            return this.rankByToken('daily_token','transferCount', 3, limit, networkId)
        } else if (type === 'rank_contract_by_number_of_transfers_1d') {
            return this.rankByToken('daily_token','transferCount', 1, limit, networkId)
        } else if (type.startsWith('rank_contract_by_number_of_')) {
            //rank_contract_by_number_of_[senders|receivers|participants]_[1d,3d,7d]
            const [which, span] = type.substr('rank_contract_by_number_of_'.length).split("_")
            const day = parseInt(span[0])
            return this.rankTokenUniqueAddr({day, which})
        } else {
            /*return {code: 40400, message: 'no support.', type}*/
            throw new Errors.ParameterError(`type=${type} not supported`);
        }
    }
    async fillInfo(list:any[], networkId) {
        const {
            app: { accountQuery, service },
        } = this;

        list.forEach(r=>{
            r.name = r.nameState === ADDR_INFO_STATE_OK ? r.name : null
            r.hex = `0x${r.hex}`
            r.base32address = format.address(r.hex, networkId)
        })

        const addressArray = list.map(item => item.base32address);
        const accountService = accountQuery || service.accountQuery;
        const accountBasic = await accountService.listPatchInfo(addressArray);
        list.forEach(item => {
            item.tokenInfo = accountBasic.map[item.base32address]?.token;
            item.contractInfo = accountBasic.map[item.base32address]?.contract;
            item.ensInfo = accountBasic.map[item.base32address]?.ens;
            item.nameTagInfo = accountBasic.map[item.base32address]?.nameTag;
            item.name = item.contractInfo?.name || item.tokenInfo?.name;
        });

        return {/*code: 0,*/ total: list.length, list, msg:'v2'};
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
