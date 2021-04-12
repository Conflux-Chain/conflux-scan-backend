// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {KEY_BLOCK_TRACE_CREATE_TX_ID, KV} from "../model/KV";
import {TransactionDB} from "../model/Transaction";
import {makeId} from "../model/HexMap";
import {TraceCreateContract} from "../model/TraceCreateContract";
const lodash = require('lodash');
const constant = require('./common/constant');

export class BlockTraceCreateSync{
    protected cfx;
    constructor(cfx:Conflux) {
        this.cfx = cfx;
        this.blockHashInEpoch = new Set<string>()
        this.previousEpoch = -1
    }

    async schedule(delay: number = 100) {
        console.log(`schedule trace_create_contract sync with delay: ${delay}`)
        await this.init();
        const that = this
        async function repeat() {
            await that.run()
            setTimeout(repeat, delay)
        }
        repeat().then()
    }

    public async init() {
        const pos = await KV.findOne({where: {key: KEY_BLOCK_TRACE_CREATE_TX_ID}})
        if (pos == null) {
            await KV.create({key: KEY_BLOCK_TRACE_CREATE_TX_ID, value: "0"})
        } else {
            await this.popEpoch()
        }
    }

    async popEpoch() {
        let maxOne = null
        while (true) {
            maxOne = await TraceCreateContract.findOne({order:[["id","desc"]], limit: 1})
            if (maxOne == null) {
                break;
            }
            if (this.previousEpoch === -1) {
                this.previousEpoch = maxOne.epochHeight
            } else if (maxOne.epochHeight !== this.previousEpoch) {
                break;
            }
            console.log(`trace_create_contract delete max one : ${JSON.stringify(maxOne)}`)
            await TraceCreateContract.destroy({where: {id: maxOne.id}})
        }
        if (maxOne !== null) {
            this.previousEpoch = maxOne.epochHeight
            await KV.update({value: maxOne.txId.toString()},
                {where: {key: KEY_BLOCK_TRACE_CREATE_TX_ID}})
        }
    }

    async run() {
        const prePos = await KV.getNumber(KEY_BLOCK_TRACE_CREATE_TX_ID)
        const curPos = prePos + 1
        const increasePos = await this.fetchByTx(curPos)
        if (increasePos) {
            await KV.update({value: curPos.toString()}, {where: {key: KEY_BLOCK_TRACE_CREATE_TX_ID}})
        }
    }

    private blockHashInEpoch: Set<string>
    private previousEpoch: number

    async fetchByTx(txId: number) : Promise<boolean>{
        // get transaction info
        const tx = await TransactionDB.findByPk(txId);
        if (tx == null) {
            const maxTxId = await TransactionDB.max("id");
            if (isNaN(NaN) || txId > maxTxId) {
                await new Promise(resolve => setTimeout(resolve, 5_000))
                return false;
            } else {
                console.log(`trace_create_contract tx not found, id ${txId}, max tx id ${maxTxId} `)
                return true;
            }
        }
        const txInfo = await this.cfx.getTransactionByHash(tx.hash)
        if (txInfo === null) {
            return false;
        }

        // check need to process
        if(tx.epochHeight < this.previousEpoch){
            console.log(`trace_create_contract should never happen! previous epoch:${this.previousEpoch}
            , tx epoch:${tx.epochHeight}, tx id:${tx.id}`);
            return true;
        }
        if(tx.epochHeight === this.previousEpoch && this.blockHashInEpoch.has(txInfo.blockHash)){
            return true;
        }
        if(tx.epochHeight > this.previousEpoch){
            this.blockHashInEpoch.clear();
            this.previousEpoch = tx.epochHeight;
        }
        this.blockHashInEpoch.add(txInfo.blockHash);

        // get trace for create
        const traceCreateArray = await this.getTraceCreateArray(txInfo.blockHash);

        // persistence to db
        for (const trace of traceCreateArray) {
            const txHashId =  (await this.handleAddress(trace.transactionHash)).id;
            const from = (await this.handleAddress(trace.from)).id;
            const addr = (await this.handleAddress(trace.addr)).id;
            await TraceCreateContract.create({
                epochHeight: trace.epochNumber,
                txHashId,
                traceIndex: trace.transactionTraceIndex,
                from,
                value: trace.value,
                addr,
                outcome: trace.outcome,
                blockTime: trace.blockTime,
            })
        }
        return true;
    }

    async handleAddress(hex: string) {
        return await makeId(hex);
    }

    async getTraceCreateArray(blockHash) {
        const traceArray = await this.getTraceByBlockHash(blockHash);
        // filter
        const createTraceArray = [];
        traceArray.forEach((trace) => {
            if (trace.status === constant.TX_STATUS.SUCCESS
                && (trace.type === constant.TRACE_TYPE.CREATE || trace.type === constant.TRACE_TYPE.CREATE_RESULT)
            ) {
                /**
                 * create:{from,gas,init,value}
                 * create_result:{addr,gasLeft,outcome,returnData}
                 */
                createTraceArray.push({
                    epochNumber: trace.epochNumber,
                    transactionHash: trace.transactionHash,
                    transactionTraceIndex: trace.transactionTraceIndex,
                    type: trace.type,
                    from: trace.action.from,
                    value: trace.action.value,
                    addr: trace.action.addr,
                    outcome: trace.action.outcome,
                    blockTime: trace.blockTime,
                });
            }
        });
        // merge
        const mergedTraceArray = [];
        if(createTraceArray.length === 0){
            return mergedTraceArray;
        }
        let createTrace;
        createTraceArray.forEach((trace, index) => {
            if(index % 2 === 0){
                createTrace = {};
                createTrace.epochNumber = trace.epochNumber;
                createTrace.transactionHash = trace.transactionHash;
                createTrace.transactionTraceIndex = trace.transactionTraceIndex;
                createTrace.from = trace.from;
                createTrace.value = trace.value;
                createTrace.blockTime = trace.blockTime;
            } else{
                createTrace.addr = trace.addr;
                createTrace.outcome = trace.outcome;
                mergedTraceArray.push(createTrace);
                console.log('===================================createTrace===>', createTrace);
            }
        })
        return mergedTraceArray;
    }

    async getTraceByBlockHash(blockHash) {
        const traceArray = [];
        // get trace
        const blockTrace:any[] = await this.cfx.traceBlock(blockHash);
        if (!blockTrace) {
            console.log(`trace_create_contract null traces at blockHash ${blockHash} `);
            return traceArray;
        }
        // get transaction
        const block:any = await this.getBlockByHash(blockHash);
        // @ts-ignore
        lodash.zip(block.transactions, blockTrace.transactionTraces)
            .forEach(([transaction, transactionTracesItem], transactionIndex) => {
                transactionTracesItem.traces.forEach((trace, transactionTraceIndex) => {
                    traceArray.push({
                        epochNumber: block.epochNumber,
                        blockHash: block.hash,
                        blockTime: block.timestamp,
                        transactionHash: transaction.hash,
                        transactionIndex,
                        transactionTraceIndex,
                        status: transaction.status,
                        ... this.parseTrace(trace),
                    });
                });
            });
        return traceArray;
    }

    async getBlockByHash(blockHash){
        const block = await this.cfx.getBlockByHash(blockHash, true);
        return this.parseBlock(block, true);
    }

    parseBlock(block, detail = false) {
        if (block.epochNumber) {
            block.epochNumber = Number(block.epochNumber);
        }
        block.timestamp = Number(block.timestamp);
        // block.miner = format.hexAddress(block.miner);
        // block.size = BigInt(block.size || 0);
        // block.difficulty = BigInt(block.difficulty || 0);
        if (detail) {
            block.transactions.forEach((transaction) => {
                transaction.from = format.hexAddress(transaction.from);
                if (transaction.to) {
                    transaction.to = format.hexAddress(transaction.to);
                }
                if (transaction.contractCreated) {
                    transaction.contractCreated = format.hexAddress(transaction.contractCreated);
                }
                if (transaction.status) {
                    transaction.status = Number(transaction.status);
                }
                transaction.gasPrice = BigInt(transaction.gasPrice || 0);
            });
        }
        return block;
    }

    parseTrace(trace) {
        if (trace.action.from) {
            trace.action.from = format.hexAddress(trace.action.from);
        }
        if (trace.action.to) {
            trace.action.to = format.hexAddress(trace.action.to);
        }
        if (trace.action.value) {
            trace.action.value = BigInt(trace.action.value);
        }
        if (trace.action.addr) {
            trace.action.addr = format.hexAddress(trace.action.addr);
        }
        return trace;
    }
}
