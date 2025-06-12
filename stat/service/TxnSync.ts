import {Op, QueryTypes} from "sequelize";
// @ts-ignore
import {Conflux, ConfluxOption, format} from "js-conflux-sdk";
import {calculateBeginTime, fmtDtUTC, pickNumber} from "../model/Utils";
import {StatApp} from "../StatApp";
import {FullBlock, FullTransaction} from "../model/FullBlock";
import {sleep} from "./tool/ProcessTool";
import {BlockAndMinerSync} from "./BlockAndMinerSync";
import {Errors} from "./common/LogicError";
import {ResultCache, TopTxParticipantBaseCache} from "../model/ResultCache";
import {EmptyTxTopData} from "../PeriodTxnSummary";
import {idHex40Map} from "../model/HexMap";
import {ZERO_ADDRESS_HEX} from "js-conflux-sdk/dist/types/CONST";

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

        let col = action.startsWith("txn") ? "count" : `amount`;
        let party = action.endsWith('Send') ? '`sender`' : '`receiver`';
        const baseCache = await ResultCache.findOne({where: {
            name: `${TopTxParticipantBaseCache}_${n}d_${col}_${party}`
        }})
        let {list, sum} = baseCache ? await JSON.parse(baseCache.content) : EmptyTxTopData;
        sum = sum === '0' ? 0 : BigInt(sum);

        const idHexMap = await idHex40Map(list.map(v=>v['addrId']), true);
        let rank = 1
        // const drip2cfx = 1e+18
        const addressArray = [];
        list.forEach(tx=>{
            tx.value = tx['v'];
            tx.percent = BigFixed(tx.value).div(BigFixed(sum||1)).mul(100)
            tx.rank = rank++
            tx.hex = idHexMap.get(tx['addrId']) || ZERO_ADDRESS_HEX;
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
            /*code: 0, message: 'ok', */list, sum, //beginTime, endTime, alignToEpoch,
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
