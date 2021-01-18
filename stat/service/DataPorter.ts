import {Op, Sequelize, QueryTypes} from "sequelize";
import {TransactionDB} from "../model/Transaction";
import {KEY_TX_EPOCH, KV} from "../model/KV";
import {Conflux, ConfluxOption} from "js-conflux-sdk";
import {calculateBeginTime, fmtDtUTC} from "../model/Utils";
import {getSumFunction} from "./DBProvider";
const BigFixed = require('bigfixed');

/**
 * sync tx
 */
export class DataPorter {
    sequelize: Sequelize
    static staticSequelize: Sequelize
    private cfx: Conflux;
    constructor(sequelize, cfx:ConfluxOption) {
        this.sequelize = sequelize;
        this.cfx = new Conflux(cfx)
        console.log(`conflux rpc url ${cfx.url}`)
        DataPorter.staticSequelize = sequelize;
    }

    public async txTopBy(n: number, type: string, limit: number, action: string = 'cfxSend') {
        const maxTime:Date = await TransactionDB.max('blockTime')
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
        const sql = `select ${aggregate} as value, ${group}, hex from tx join hex40 on tx.${group} = hex40.id 
             where blockTime between ? and ?
             group by ${group} order by value desc limit 10`;
        console.log('sql is: ', sql)
        const list:any[] = await this.sequelize.query(sql, {
            replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
            type: QueryTypes.SELECT,
            benchmark: true, logging: console.log
        })
        let sumOption = {where:{
                blockTime: {[Op.between]: [beginTime, endTime]}
            }};
        const sum =  action.startsWith("txn") ? await TransactionDB.count(sumOption)
          : await TransactionDB.sum('value', sumOption)
        let rank = 1
        list.forEach(tx=>{
            tx.percent = BigFixed(tx.value).div(BigFixed(sum)).mul(100)
            tx.rank = rank++
        })
        return Promise.resolve({
            code: 0, message: 'ok', list, sum, beginTime, endTime
        })
    }

    public async schedule() {
        const that = this;
        async function repeat() {
            await that.run();
            setTimeout(repeat, 300)
        }
        repeat().then()
    }

    async run() {
        const preEpoch = await KV.getNumber(KEY_TX_EPOCH) || 0
        await this.copyEpoch(preEpoch)
    }

    async copyEpoch(epoch: number) {
        const blockHashes = await this.cfx.getBlocksByEpochNumber(epoch)
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
        }).forEach(txList=>txList.filter(tx=>{
            if (tx.status === null && epoch > 0) {
                // console.log(`tx status is null, epoch ${epoch} ${tx.hash}`)
            }
            return tx.status === '0x0' || epoch === 0;
        }).forEach(tx=>allTx.push(tx)))
        let txOk = 'not executed';
        const txCount = allTx.length;
        await DataPorter.staticSequelize.transaction(async (dbTx) => {
            await Promise.all(
                allTx.map(async (tx) => {
                    tx['data'] = ''
                    // console.log(`tx is ${JSON.stringify(tx, null , 4)}`)
                    tx.to = tx.to || '0x0'
                    tx.epochHeight = epoch;
                    tx.gas = parseInt(tx.gas, 16)
                    tx.value = parseInt(tx.value, 16)
                    tx.nonce = parseInt(tx.nonce, 16)
                    tx.txIndex = parseInt(tx.transactionIndex, 16) || 0
                    tx.blockTime = new Date(parseInt(tx.blockTime, 16) * 1000)
                    await TransactionDB.add(tx, dbTx)
                })
            ).then(async ()=>{
                return KV.upsert({key: KEY_TX_EPOCH, value: (epoch + 1).toString()}, {
                    transaction:dbTx
                })
            })
            txOk = 'ok'
        }).then(()=>{
            if (epoch % 100 === 0 || txCount > 10 ) {
                console.log(`${fmtDtUTC(new Date())} insert ${txCount} txn at epoch ${epoch}`)
            }
        }).catch(err=>{
            console.error(`tx fail, epoch ${epoch}:`, err)
            process.exit(500)
        })
        return {txOk, txCount};
    }
}