// @ts-ignore
import {Conflux, Contract, format} from "js-conflux-sdk";
import {KEY_BLOCK_TRACE_TX_ID, KV} from "../model/KV";
import {TransactionDB} from "../model/Transaction";
import {Trace} from "../model/Trace";
import {makeId} from "../model/HexMap";
import {fmtDtUTC} from "../model/Utils";
import {EventBus} from "./watcher/EventBus";
const pLimit = require('p-limit');
const limit = pLimit(100);

export class BlockTraceSync{
    protected cfx;
    private miniERC20: Contract;
    constructor(cfx:Conflux) {
        this.cfx = cfx;
        this.blockHashInEpoch = new Set<string>()
        this.previousEpoch = -1
        const {abi, bytecode} = require('./watcher/contract/miniERC20.json');
        this.miniERC20 = <Contract>cfx.Contract({abi, bytecode});
    }

    async schedule(delay: number = 100) {
        console.log(`schedule trace sync with delay: ${delay}`)
        await this.init();
        //
        const that = this
        async function repeat() {
            // console.log('trace sync')
            await that.run()
            setTimeout(repeat, delay)
        }
        repeat().then()
    }

    public async init() {
        const pos = await KV.findOne({where: {key: KEY_BLOCK_TRACE_TX_ID}})
        if (pos == null) {
            await KV.create({key: KEY_BLOCK_TRACE_TX_ID, value: "0"})
        } else {
            await this.popEpoch(pos)
        }
    }

    /**
     * pop trace of the max epoch in db, since it may contains partial data.
     * {@link fetchByTx}
     * @param pos
     */
    async popEpoch(pos:KV) {
        let maxOne = null
        while (true) {
            maxOne = await Trace.findOne({order:[["id","desc"]], limit: 1})
            if (maxOne == null) {
                break;
            }
            if (this.previousEpoch === -1) {
                this.previousEpoch = maxOne.epochHeight
            } else if (maxOne.epochHeight !== this.previousEpoch) {
                // pop until epoch height changes.
                break;
            }
            console.log(`delete max one : ${JSON.stringify(maxOne)}`)
            await Trace.destroy({where: {id: maxOne.id}})
        }
        if (maxOne !== null) {
            this.previousEpoch = maxOne.epochHeight
            await KV.update({value: maxOne.txId.toString()},
                {where: {key: KEY_BLOCK_TRACE_TX_ID}})
        }
    }

    async run() {
        const prePos = await KV.getNumber(KEY_BLOCK_TRACE_TX_ID)
        const curPos = prePos + 1
        const increasePos = await this.fetchByTx(curPos)
        if (increasePos) {
            await KV.update({value: curPos.toString()}, {where: {key: KEY_BLOCK_TRACE_TX_ID}})
        }
    }

    private blockHashInEpoch: Set<string>
    private previousEpoch: number
    /**
     * Take tx as the main line, could skip most empty block(without tx).
     * Known issues: txId will be mistake in case the block contains more than one tx.
     * The main usage of tracing is to collect [hidden] address.
     * @param epoch
     */
    async fetchByTx(txId: number) : Promise<boolean>{
        const tx = await TransactionDB.findByPk(txId);
        if (tx == null) {
            const maxTxId:number = await TransactionDB.max("id");
            if (txId > maxTxId) {
                await new Promise(resolve => setTimeout(resolve, 5_000))
            } else if (isNaN(maxTxId)) {
                await new Promise(resolve => setTimeout(resolve, 5_000))
            } else {
                console.log(`tx not found, id ${txId}, max tx id ${maxTxId} `)
            }
            return txId < maxTxId;

        }
        const txInfo = await this.cfx.getTransactionByHash(tx.hash)
        if (txInfo === null) {
            return false;
        }
        await this.parseTxLog(tx.hash, tx.blockTime)
        if (tx.epochHeight === 0) {
            // skip epoch 0
            return true;
        } else if (tx.epochHeight < this.previousEpoch) {
            console.log(`epoch should keep growing, previous ${this.previousEpoch
            }, tx epoch height ${tx.epochHeight}, tx id in db ${tx.id}`);
            return true;
        } else if (tx.epochHeight === this.previousEpoch) {
            // it's ok
            if (this.blockHashInEpoch.has(txInfo.blockHash)) {
                // one block may contains multiple tx, that is, two or more tx may have the same block hash,
                // need avoid processing one block multiple times.
                // console.log(`tx id ${tx.id}, processed block ${txInfo.blockHash}`)
                return true;
            }
        } else {
            // move to higher epoch
            this.blockHashInEpoch.clear();
            this.previousEpoch = tx.epochHeight;
        }
        this.blockHashInEpoch.add(txInfo.blockHash)
        const traces:any[] = await this.cfx.traceBlock(txInfo.blockHash);
        if (traces == null) {
            console.log(`null traces at tx id ${tx.id} epoch ${txInfo.epochHeight} block:`, txInfo.blockHash)
            return true;
        }
        let traceCount = 0
        // @ts-ignore
        for (const obj of traces.transactionTraces) {
            for (const t of obj.traces) {
                if (t.type === 'call_result') {
                    continue
                } else if (t.action.from === undefined) {
                    console.log(`trace action.from miss, block hash ${txInfo.blockHash}`);
                    continue;
                }
                let from = format.hexAddress(t.action.from);
                let fromId = (await this.handleAddress(from, tx.blockTime)).id
                let to = t.action.to === undefined ? "" : format.hexAddress(t.action.to)
                let toId = to === "" ? 0 : (await this.handleAddress(to, tx.blockTime)).id
                let value = t.action.value
                if (value > 0) {
                    await Trace.create({
                        epochHeight: tx.epochHeight, txId: tx.id,
                        from: fromId,
                        to: toId,
                        value: value, blockTime: tx.blockTime
                    })
                }
                traceCount ++
            }
        }
        // console.log(`${fmtDtUTC(new Date())} trace count ${traceCount}, block ${txInfo.blockHash}`)
        return true;
    }

    public async parseTxLog(hash: string, blockTime: Date) {
        let hexCache = new Set<string>()
        const { epochNumber, logs = [] } = await limit(()=>this.cfx.getTransactionReceipt(hash)) || {};
        if (logs.length === 0) {
            return;
        }
        await Promise.all(logs.map(async log=>{
            // console.log(`raw log is:`, log)
            let parsedLog = undefined
            try {
                // @ts-ignore
                parsedLog = this.miniERC20.Transfer.decodeLog(log)
            } catch (e) {
                return
            }
            let hexFrom = format.hexAddress(parsedLog[0]);
            let hexTo = format.hexAddress(parsedLog[1]);
            let hasFrom = hexCache.has(hexFrom)
            if (!hasFrom) {
                hexCache.add(hexFrom)
                await this.handleAddress(hexFrom, blockTime)
            }
            let hasTo = hexCache.has(hexTo);
            if (!hasTo) {
                hexCache.add(hexTo)
                await this.handleAddress(hexTo, blockTime)
            }
            if (!hasFrom || !hasTo) {
                // console.log(`parsed log:`, hexFrom, hexTo);
            }
        })).catch(err=>{
            console.log(`parse log fail, hash ${hash}`, err)
        })
    }

    async handleAddress(hex: string, dt:Date) {
        let ret = await makeId(hex, undefined, {dt});
        EventBus.processTxAddress(hex)
        return ret
    }
}