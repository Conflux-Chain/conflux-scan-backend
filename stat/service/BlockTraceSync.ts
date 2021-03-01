// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {KEY_BLOCK_TRACE_TX_ID, KV} from "../model/KV";
import {TransactionDB} from "../model/Transaction";
import {Trace} from "../model/Trace";
import {makeId} from "../model/HexMap";
import {fmtDtUTC} from "../model/Utils";

export class BlockTraceSync{
    protected cfx;
    constructor(cfx:Conflux) {
        this.cfx = cfx;
        this.blockHashInEpoch = new Set<string>()
        this.previousEpoch = -1
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
     * @param epoch
     */
    async fetchByTx(txId: number) : Promise<boolean>{
        const tx = await TransactionDB.findByPk(txId);
        if (tx == null) {
            const maxTxId = await TransactionDB.max("id");
            console.log(`tx not found, id ${txId}, max tx id ${maxTxId} `)
            return txId < maxTxId;

        }
        const txInfo = await this.cfx.getTransactionByHash(tx.hash)
        if (txInfo === null) {
            return false;
        }
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
                // console.log(`trace ${t.action.from}`)
                let from = format.hexAddress(t.action.from)
                let fromId = (await makeId(from)).id
                let to = t.action.to === undefined ? "" : format.hexAddress(t.action.to)
                let toId = to === "" ? 0 : (await makeId(to)).id
                let value = t.action.value
                if (value > 0) {
                    await Trace.create({
                        epochHeight: txInfo.epochHeight, txId: tx.id,
                        from: fromId,
                        to: toId,
                        value: value, blockTime: tx.blockTime
                    })
                }
                traceCount ++
            }
        }
        console.log(`${fmtDtUTC(new Date())} trace count ${traceCount}, block ${txInfo.blockHash}`)
        return true;
    }
}