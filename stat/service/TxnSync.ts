import {Op, QueryTypes} from "sequelize";
// @ts-ignore
import {Conflux, ConfluxOption, format} from "js-conflux-sdk";
import {calculateBeginTime, fmtDtUTC, pickNumber} from "../model/Utils";
import {StatApp} from "../StatApp";
import {FullBlock, FullTransaction} from "../model/FullBlock";
import {sleep} from "./tool/ProcessTool";
import {BlockAndMinerSync} from "./BlockAndMinerSync";
import {Errors} from "./common/LogicError";

const BigFixed = require('bigfixed');

/**
 * sync tx
 */
export class TxnSync {
    private app: StatApp;
    private cfx: Conflux;
    // refreshed in TxnSync.scheduleCache()
    private rankCache: Map<string, Object>
    constructor(app:any) {
        this.app = app;
        this.cfx = app.cfx
        this.rankCache = new Map<string, Object>()
    }

    public async txTopBy(n: number, type: string, limit: number, action: string = 'cfxSend',
                         networkId: number = 1029, useCache=true) {
        const {
            app: { accountQuery },
        } = this;

        limit = pickNumber(limit, 10)
        // cache
        const cacheKey = `${n}${type}${limit}${action}`
        const cacheV = useCache ? this.rankCache.get(cacheKey) : undefined;
        if (cacheV !== undefined) {
            return Promise.resolve(cacheV);
        }
        // cache end
        const maxTx = await FullTransaction.findOne({order: [['epoch','desc']]});
        if (maxTx == null) {
            return Promise.resolve({
                code: 500, message: 'Empty Data.'
            })
        }
        // align different servers with same end time.
        let alignToEpoch = maxTx.epoch;
        alignToEpoch = alignToEpoch -  (alignToEpoch % 1000);
        // tx may be absent but block must exist
        const alignBlock = await FullBlock.findOne({where:{epoch: alignToEpoch}});
        if (alignBlock == null) {
            return Promise.resolve({
                code: 500, message: 'Empty Data!'
            })
        }
        const maxEpoch = alignBlock.epoch;
        const endTime = alignBlock.createdAt;
        // console.log(` end time is ${endTime}`, endTime)
        let beginTime: Date;
        try {
            beginTime = await calculateBeginTime(n, type, endTime);
        } catch (err) {
/*            console.log(` error calculateBeginTime:`, err)
            return Promise.resolve({
                code: 501, message: `${err}`
            })*/
            throw new Errors.ParameterError(`calculateBeginTime error: ${err.message}`);
        }
        const[{epoch:minEpoch}] = await Promise.all([
            FullTransaction.findOne({where: {createdAt:{[Op.gte]:beginTime}},
                order:[['createdAt','asc']], limit: 1}),
        ])
        let aggregate = action.startsWith("txn") ? "COUNT(*)" : `sum(dripValue)`;
        let group = action.endsWith('Send') ? '`fromId`' : '`toId`'
        const sql = `select t.*, hex from (select ${aggregate} as value, ${group} from full_tx
                where epoch between ? and ? and status = 0 group by ${group} order by value desc limit ?) t 
                join hex40 on t.${group} = hex40.id `;
        // console.log('sql is: ', sql)
        const list:any[] = await FullTransaction.sequelize.query(sql, {
            replacements: [minEpoch, maxEpoch, limit],
            type: QueryTypes.SELECT,
            // benchmark: true, logging: console.log
        })
        let sumOption = {where:{
                epoch: {[Op.between]: [minEpoch, maxEpoch]}
            }};
        const sum =  action.startsWith("txn") ? await FullTransaction.count(sumOption)
          : await FullTransaction.sum('dripValue', sumOption)
        let rank = 1
        // const drip2cfx = 1e+18
        const addressArray = [];
        list.forEach(tx=>{
            // tx.value = BigFixed(tx.value).div(BigFixed(drip2cfx))
            tx.percent = BigFixed(tx.value).div(BigFixed(sum||1)).mul(100)
            tx.rank = rank++
            tx.hex = `0x${tx.hex}`
            tx.base32 = this.base32(tx.hex, networkId)
            addressArray.push(tx.base32);
        })

        // add contract info and token info
        const accountBasic = await accountQuery.listPatchInfo(addressArray);
        list.forEach(item => {
            item.tokenInfo = accountBasic.map[item.base32]?.token || {};
            item.contractInfo = accountBasic.map[item.base32]?.contract || {};
            item.ensInfo = accountBasic.map[item.base32]?.ens || {};
            item.nameTagInfo = accountBasic.map[item.base32]?.nameTag || {};
        });

        let finalRet = {
            /*code: 0, message: 'ok', */list, sum, beginTime, endTime, alignToEpoch,
        };
        this.rankCache.set(cacheKey, finalRet)
        return Promise.resolve(finalRet)
    }


    base32(hex, networkId) {
        if (hex === null || hex === undefined || hex === '' || hex === '0x') {
            return ''
        }
        return format.address(hex, networkId)
    }

    public scheduleCache(delay:number = 600_000) {
        const that = this

        async function refreshAction(action: string) {
            await that.txTopBy(24, 'h', 10, action, StatApp.networkId, false)
            await sleep(1000)
            await that.txTopBy(3, 'd', 10, action, StatApp.networkId, false)
            await sleep(1000)
            await that.txTopBy(7, 'd', 10, action, StatApp.networkId, false)
        }
        async function refreshMinerRank() {
            //
            await sleep(1000)
            await BlockAndMinerSync.topByType(24, 'h', 10, false)
            await sleep(1000)
            await BlockAndMinerSync.topByType(3, 'd', 10,false)
            await sleep(1000)
            await BlockAndMinerSync.topByType(7, 'd', 10, false)
        }

        async function refreshCache(){
            console.log(`${fmtDtUTC(new Date())} refresh cache`)
            let action = 'cfxSend';
            await refreshAction(action).catch(e=>console.log(`refreshAction failed ${action}`, e));
            await refreshAction('cfxReceived').catch(e=>console.log(`refreshAction failed 'cfxReceived'`, e));
            await refreshAction('txnSend').catch(e=>console.log(`refreshAction failed txnSend`, e));
            await refreshAction('txnReceived').catch(e=>console.log(`refreshAction failed txnReceived`, e));
            await refreshMinerRank().catch(e=>console.log(`refreshAction failed minerRank`, e))
            setTimeout(refreshCache, delay)
        }
        refreshCache().then()
    }
}
