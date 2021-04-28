import {Op, Sequelize, QueryTypes} from "sequelize";
import {TransactionDB} from "../model/Transaction";
import {KEY_TX_EPOCH, KV} from "../model/KV";
// @ts-ignore
import {Conflux, ConfluxOption, format} from "js-conflux-sdk";
import {calculateBeginTime, fmtDtUTC, pickNumber} from "../model/Utils";
import {getSumFunction} from "./DBProvider";
import {Stopwatch} from "./Stopwatch";
import {StatApp} from "../StatApp";
import {makeId as makeAddrId} from "../model/HexMap";
const BigFixed = require('bigfixed');

/**
 * sync tx
 */
export class TxnSync {
    sequelize: Sequelize
    static staticSequelize: Sequelize
    private cfx: Conflux;
    private rankCache: Map<string, Object>
    constructor(sequelize, cfx:ConfluxOption) {
        this.sequelize = sequelize;
        this.cfx = new Conflux(cfx)
        this.rankCache = new Map<string, Object>()
        console.log(`conflux rpc url ${cfx.url}`)
        TxnSync.staticSequelize = sequelize;
    }

    public async txTopBy(n: number, type: string, limit: number, action: string = 'cfxSend',
                         networkId: number = 1029) {
        limit = pickNumber(limit, 10)
        // cache
        const cacheKey = `${n}${type}${limit}${action}`
        const cacheV = this.rankCache.get(cacheKey);
        if (cacheV !== undefined) {
            return Promise.resolve(cacheV);
        }
        // cache end
        const maxTime:Date = await TransactionDB.max('blockTime');
        if (maxTime == null) {
            return Promise.resolve({
                code: 500, message: 'Empty Data.'
            })
        }
        const endTime = maxTime;
        let beginTime: Date;
        try {
            beginTime = await calculateBeginTime(n, type, endTime);
        } catch (err) {
            return Promise.resolve({
                code: 501, message: `${err}`
            })
        }
        let aggregate = action.startsWith("txn") ? "COUNT(*)" : `${getSumFunction()}(value)`;
        let group = action.endsWith('Send') ? '`from`' : '`to`'
        const sql = `select t.*, hex from (select ${aggregate} as value, ${group} from tx
                where blockTime between ? and ? and status = 0 group by ${group} order by value desc limit ?) t 
                join hex40 on t.${group} = hex40.id `;
        // console.log('sql is: ', sql)
        const list:any[] = await this.sequelize.query(sql, {
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime), limit],
            type: QueryTypes.SELECT,
            // benchmark: true, logging: console.log
        })
        let sumOption = {where:{
                blockTime: {[Op.between]: [beginTime, endTime]}
            }};
        const sum =  action.startsWith("txn") ? await TransactionDB.count(sumOption)
          : await TransactionDB.sum('value', sumOption)
        let rank = 1
        // const drip2cfx = 1e+18
        list.forEach(tx=>{
            // tx.value = BigFixed(tx.value).div(BigFixed(drip2cfx))
            tx.percent = BigFixed(tx.value).div(BigFixed(sum)).mul(100)
            tx.rank = rank++
            tx.hex = `0x${tx.hex}`
            tx.base32 = this.base32(tx.hex, networkId)
        })
        let finalRet = {
            code: 0, message: 'ok', list, sum, beginTime, endTime
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

    public scheduleCache(delay:number = 60_000) {
        const that = this

        async function refreshAction(action: string) {
            await that.txTopBy(24, 'h', 10, action, StatApp.networkId)
            await new Promise(resolve => setTimeout(resolve, 5_000))
            await that.txTopBy(3, 'd', 10, action, StatApp.networkId)
            await new Promise(resolve => setTimeout(resolve, 5_000))
            await that.txTopBy(7, 'd', 10, action, StatApp.networkId)
            await new Promise(resolve => setTimeout(resolve, 5_000))
        }

        async function refreshCache(){
            console.log(`${fmtDtUTC(new Date())} refresh cache`)
            let action = 'cfxSend';
            await refreshAction(action);
            await refreshAction('cfxReceived');
            await refreshAction('txnSend');
            await refreshAction('txnReceived');
            setTimeout(refreshCache, delay)
        }
        refreshCache().then()
    }

    public async schedule(delay:number = 100) {
        console.log(`sync tx with delay ${delay}`)
        const that = this;
        async function repeat() {
            await that.run().catch(err=>{
                console.log(`sync tx fail: `, err)
            });
            setTimeout(repeat, delay)
        }
        repeat().then()
        this.scheduleCache()
    }

    async run() :Promise<{ txOk: string, txCount: number }> {
        const preEpoch = await KV.getNumber(KEY_TX_EPOCH) || 0
        return await this.copyEpoch(preEpoch)
    }

    async copyEpoch(epoch: number) : Promise<{ txOk: string, txCount: number, epoch:number }>{
        // @ts-ignore
        const epochConfirmed = await this.cfx.getEpochNumber('latest_confirmed')
        if (epoch > epochConfirmed) {
            return ;
        }
        const stopwatch = new Stopwatch();
        stopwatch.start('getBlocksByEpochNumber')
        const blockHashes = await this.cfx.getBlocksByEpochNumber(epoch).catch(err=>{
            console.log(`error for epoch ${epoch}`, err)
            return null
        })
        if (blockHashes === null) {
            await new Promise(resolve => setTimeout(resolve, 5000))
            return;
        }
        stopwatch.start('getBlockByHash')
        let id = 0;
        const blockList: any[] = await this.cfx.provider.batch(blockHashes.map(hash=>{
            return {
                id: id++, "jsonrpc": "2.0", "method": "cfx_getBlockByHash",
                params: [hash, true]
            }
        }));
        const allTx = []
        blockList.map(blk=>{
            blk.transactions.forEach(tx=>tx.blockTime = blk.timestamp)
            return blk.transactions
        }).forEach(txList=>
            // 0 for success, 1 if an error occurred, null when the transaction is skipped or not packed.
            txList.filter(tx=>tx.status !== null && tx.status !== '')
                .forEach(tx=>{
                tx.from = format.hexAddress(tx.from) //base32 address to hex
                if (tx.to) {
                    tx.to = format.hexAddress(tx.to)
                } else {
                    tx.to = '0x0'
                }
                allTx.push(tx)
            })
        )
        const txArr = []
        for (const tx of allTx) {
            tx.gas = parseInt(tx.gas, 16)
            tx.gasPrice = parseInt(tx.gasPrice, 16)
            tx.status = (tx.status === null || tx.status === '') ? null : parseInt(tx.status, 16)
            tx.value = parseInt(tx.value, 16)
            tx.nonce = parseInt(tx.nonce, 16)
            tx.txIndex = parseInt(tx.transactionIndex, 16) || 0
            tx.blockTime = new Date(parseInt(tx.blockTime, 16) * 1000)
            tx['data'] = ''
            tx.epochHeight = epoch;
            const fromId = await makeAddrId(tx.from, null, {dt:tx.blockTime});
            const toId = await makeAddrId(tx.to, null, {dt:tx.blockTime});
            tx.from = fromId.id
            tx.to = toId.id
            txArr.push(tx)
        }
        stopwatch.start('db transaction phase 0')
        let txOk = 'not executed';
        const txCount = allTx.length;
        await TxnSync.staticSequelize.transaction(async (dbTx) => {
            // https://developer.conflux-chain.org/docs/conflux-doc/docs/json_rpc#cfx_gettransactionbyhash
            stopwatch.start('db transaction phase 1')
            await TransactionDB.bulkCreate(txArr, {transaction: dbTx}
            ).then(async ()=>{
                stopwatch.start('db transaction phase 2')
                return KV.upsert({key: KEY_TX_EPOCH, value: (epoch + 1).toString()}, {
                    transaction:dbTx
                })
            })
            txOk = 'ok'
        }).then(()=>{
            if (epoch % 100 === 0) {
                // stopwatch.dump('time costs:')
                console.log(`${fmtDtUTC(new Date())} insert ${txCount} txn at epoch ${epoch}`)
            }
        }).catch(err=>{
            console.error(`tx fail, epoch ${epoch}:`, err)
        })
        return {txOk, txCount, epoch};
    }
}