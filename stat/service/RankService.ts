import {QueryTypes} from "sequelize";
import {
    ADDR_INFO_STATE_OK,
    buildHexSet,
    idHex40Map, mapProp,
} from "../model/HexMap";
// @ts-ignore
import {format} from 'js-conflux-sdk'
import {StatApp} from "../StatApp";
import {CfxBalance} from "../model/Balance";
import {Op} from "sequelize"
import {AddressTransactionIndex} from "../model/FullBlock";
import {DailyToken} from "../model/Token";
import {PruneInfo} from "../model/PruneInfo";
import {loadTopUniqueBaseCache} from "./UniqueAddressStat";
import {IS_EVM2, KV} from "../model/KV";
import {Errors} from "./common/LogicError";
import { ethers } from "ethers";
import {ResultCache, TopUniqueCache} from "../model/ResultCache";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";

export class RankService{
    private app: any;
    txnMap = new Map<number, any>()
    constructor(app) {
        this.app = app;
    }

    public repeatUpdateTxnCache() {
        // update unique addr cache.
        // always update 24h(1 day).
        this.rankTokenUniqueAddr({day: 1}).then(async ()=>{
            const hour = new Date().getHours();
            // check result cache in db, build if absent
            const cache = await this.loadUniqueAddrCache(3);
            // update 3d and 7d by condition.
            if (hour === 0 || !cache['maxTimeStart']) {
                await this.rankTokenUniqueAddr({day: 3})
                await this.rankTokenUniqueAddr({day: 7});
            }
        }).then(async () => {
            //
            const cnt = 100
            await this.rankCfxBalance('total', cnt, true);
            await this.rankCfxBalance('stakingBalance', cnt, true);
            return this.rankCfxBalance('balance', cnt, true);
        }).catch(err => {
            safeAddErrorLog('rank-service',` update token unique addr fail.`, err).then();
        }).finally(()=>{
            // at least, fire an alert for each round.
            setTimeout(()=>this.repeatUpdateTxnCache(), 1000*60 * 40) // x minutes
        })
    }
    async rankCfxBalance(order:string, limit, updateTxnCache=false) {
        const sql = ` 
            select h.hex, addressId, ${order}, balance as value2, stakingBalance as value3, total as value4 from
            (select * from cfx_balance where ${order} > 1 order by ${order} desc, cfx_balance.addressId asc limit ?) b
            left join hex40 h on h.id = b.addressId
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
    async loadUniqueAddrCache(day: number) {
        const bean = await ResultCache.findOne({
            where: {name: `${TopUniqueCache}_${day}`}, raw: true,
        })
        return JSON.parse(bean?.content || '{}');
    }
    async rankTokenUniqueAddr({day = 7}) {
        const {maxTimeStart, list, timeBegin, alignTimeEnd} = await loadTopUniqueBaseCache(day);
        const now = new Date();
        const [senders, receivers, participants] = await Promise.all(
            ['sender','receiver','all'].map(k=>{
                return this.buildUniqueAddrTop(list[k], k).then(res=>{
                    res["maxTimeStart"] = maxTimeStart;
                    res['alignTimeEnd'] = alignTimeEnd;
                    res['cacheTime'] = now;
                    return res;
                })
            })
        )
        const result = {maxTimeStart, timeBegin, senders, receivers, participants};
        return ResultCache.upsert(
            {content: JSON.stringify(result, null, 4), name: `${TopUniqueCache}_${day}`},
        ).then(()=>{
            console.log(`update top unique cache of ${TopUniqueCache}_${day} , ${new Date().toISOString()}`);
        }).catch(err=>{
            safeAddErrorLog('rank-service', 'top-unique-cache', err);
        });
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
        const isEvm = await KV.getSwitch(IS_EVM2)
        const totalCfx = isEvm ? (await this.app.cfx.getSupplyInfo().then(res=>Number(res.totalEspaceTokens/BigInt(1e18)))) :
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
            const cache = await this.loadUniqueAddrCache(day);
            return cache[which] || {message: 'not ready'};
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
            r.hex = r.hex ? ethers.utils.getAddress(r.hex) : `0x${r.hex}`
            r.base32address = format.address(r.hex, networkId)
        })

        const addressArray = list.map(item => item.base32address);
        const accountService = accountQuery || service.accountQuery;
        const accountBasic = await accountService.listPatchInfo(addressArray);
        list.forEach(item => {
            const mapRefKey = StatApp.isEVM ? item.hex : item.base32address;
            item.tokenInfo = accountBasic.map[mapRefKey]?.token;
            item.contractInfo = accountBasic.map[mapRefKey]?.contract;
            item.ensInfo = accountBasic.map[mapRefKey]?.ens;
            item.nameTagInfo = accountBasic.map[mapRefKey]?.nameTag;
            item.name = item.contractInfo?.name || item.tokenInfo?.name;
        });

        return {/*code: 0,*/ total: list.length, list, accountMap: accountBasic};
    }
}
