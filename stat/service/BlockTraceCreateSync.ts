// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {KEY_BLOCK_TRACE_CREATE_EPOCH, KV} from "../model/KV";
import {makeId} from "../model/HexMap";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {fmtDtUTC} from "../model/Utils";
import {batchBlockDetail, batchFetchBlock, batchTraceBlock} from "./common/utils";
const lodash = require('lodash');
const CONST = require('./common/constant');

export class BlockTraceCreateSync{
    protected cfx;

    constructor(cfx:Conflux) {
        this.cfx = cfx;
    }

    public async schedule(delay: number = 100) {
        console.log(`schedule trace_create_contract sync with delay: ${delay}`)
        await BlockTraceCreateSync.init();
        const that = this
        async function repeat() {
            await that.run()
            setTimeout(repeat, delay)
        }
        repeat().then()
    }

    private static async init() {
        const preEpoch = await KV.findOne({where: {key: KEY_BLOCK_TRACE_CREATE_EPOCH}})
        if (preEpoch == null) {
            await KV.create({key: KEY_BLOCK_TRACE_CREATE_EPOCH, value: "0"})
        } else {
            await BlockTraceCreateSync.popEpoch(Number(preEpoch.value));
        }
    }

    private static async popEpoch(preEpoch: number) {
        const latestEpoch = preEpoch + 1;
        const rows = await TraceCreateContract.destroy({where: {epochNumber: latestEpoch}});
        console.log(`trace_create_contract pop ${rows}rows at latestEpoch:${latestEpoch}, currentEpoch:${preEpoch}`);
    }

    private async run() {
        const preEpoch = await KV.getNumber(KEY_BLOCK_TRACE_CREATE_EPOCH)
        const curEpoch = preEpoch + 1

        const epochConfirmed = await this.cfx.getEpochNumber('latest_confirmed')
        if(curEpoch > epochConfirmed){
            await new Promise(resolve => setTimeout(resolve, 1000))
        }

        try{
            await this.syncByEpoch(curEpoch)
        }catch (e){
            const msg = `${e}`
            if (msg.includes('expected a numbers with less than largest epoch number.')) {
                // const latest = await this.cfx.getEpochNumber('latest_state');
                // console.log(`trace_create_contract epoch:${curEpoch} latestState:${latest} not executed`)
                await new Promise(resolve => setTimeout(resolve, 3000))
            } else {
                console.log(`trace_create_contract epoch:${curEpoch} error:${msg}`)
                throw e;
            }
        }
    }

    public async syncByEpoch(epochNumber: number) : Promise<boolean>{
        const traceCreateArray = await this.getTraceCreateArray(epochNumber);
        const blockDt = traceCreateArray.length > 0 ? new Date(traceCreateArray[0].blockTime*1000) : undefined
        const beans = []
        for (const trace of traceCreateArray) {
            const txHashId =  (await makeId(trace.transactionHash)).id;
            const from = (await makeId(trace.from, undefined, {dt:blockDt})).id;
            const to = (await makeId(trace.to, undefined, {dt:blockDt})).id;
            const toCreate = {
                epochNumber: trace.epochNumber,
                txHashId,
                traceIndex: trace.transactionTraceIndex,
                from,
                to,
                value: trace.value,
                outcome: trace.outcome,
                blockTime: trace.blockTime,
            };
            beans.push(toCreate)
        }
        await TraceCreateContract.sequelize.transaction(async dbTx=>{
            await Promise.all([
                // TraceCreateContract.bulkCreate(beans, {transaction: dbTx}),
                // KV.update({value: epochNumber.toString()},
                //     {where: {key: KEY_BLOCK_TRACE_CREATE_EPOCH}, transaction: dbTx}),
            ])
        })
        // if (epochNumber % 100 === 0) {
        //     const count = traceCreateArray.length;
        //     console.log(`${fmtDtUTC(new Date())} insert ${count} trace_create_contract at epoch:${epochNumber}`)
        // }
        return true;
    }

    async getTraceCreateArray(epochNumber) {
        const traceArray = await this.getTraceArray(epochNumber);
        // filter
        const createTraceArray = [];
        traceArray.forEach((trace) => {
            if (trace.status === CONST.TX_STATUS.SUCCESS && trace.type === CONST.TRACE_TYPE.CREATE) {
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
                    to: trace.action.to,
                    value: trace.action.value,
                    outcome: trace.action.outcome,
                    blockTime: trace.blockTime,
                });
            }
        });
        return createTraceArray;
    }

    async getTraceArray(epochNumber) {
        let traceArray = [];
        const [blockArray, traceArray2d] = await this.getBlockArray(epochNumber);
        blockArray.forEach((block, idx) => {
            if (!block.transactions.length) {
                return;
            }

            const blockTrace:any = traceArray2d[idx]
            if (!blockTrace) {
                // console.error(`trace_create_contract no trace at block:${block.hash}`);
                return traceArray;
            }

            //assemble traces
            // @ts-ignore
            lodash.zip(block.transactions, blockTrace.transactionTraces)
                .forEach(([transaction, transactionTracesItem], transactionIndex) => {
                    const transactionTraceArray = [];
                    transactionTracesItem.traces.forEach((trace, transactionTraceIndex) => {
                        transactionTraceArray.push({
                            epochNumber: block.epochNumber,
                            blockHash: block.hash,
                            blockTime: block.timestamp,
                            transactionHash: transaction.hash,
                            transactionIndex,
                            transactionTraceIndex,
                            status: transaction.status,
                            ...this.parseTrace(trace),
                        });
                    });
                    traceArray = [...traceArray, ...BlockTraceCreateSync.matchTrace(transactionTraceArray, transaction)];
                });
        });
        return traceArray;
    }

    private async getBlockArray(epochNumber) : Promise<any[]> {
        const blockHashArray = await this.cfx.getBlocksByEpochNumber(epochNumber);
        const [blockArray, traceArray] = await batchBlockDetail(this.cfx, blockHashArray)
        blockArray.map((v) => this.parseBlock(v, true));
        return [blockArray, traceArray]
    }

    private parseBlock(block, detail = false) {
        if (block.epochNumber) {
            block.epochNumber = Number(block.epochNumber);
        }
        block.timestamp = Number(block.timestamp);
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

    private parseTrace(trace) {
        if (trace.action.from) {
            trace.action.from = format.hexAddress(trace.action.from);
        }
        if (trace.action.value) {
            trace.action.value = BigInt(trace.action.value);
        }
        if (trace.action.to) {
            trace.action.to = format.hexAddress(trace.action.to);
        }
        if (trace.action.addr) {
            trace.action.addr = format.hexAddress(trace.action.addr);
        }
        if (trace.action.input) {
            trace.action.input = '';
        }
        if (trace.action.init) {
            trace.action.init = '';
        }
        return trace;
    }

    private static matchTrace(transactionTraceArray, transaction){
        if (!transactionTraceArray.length) {
            return[];
        }

        const stack = [];
        for(let i = 0; i < transactionTraceArray.length; i++){
            const nextTrace = transactionTraceArray[i];
            if(nextTrace.type !== CONST.TRACE_TYPE.CREATE && nextTrace.type !== CONST.TRACE_TYPE.CREATE_RESULT){
                continue;
            }
            if(nextTrace.type === CONST.TRACE_TYPE.CREATE){
                stack.push(i);
            }
            if(nextTrace.type === CONST.TRACE_TYPE.CREATE_RESULT){
                const creatTraceIndex = stack.pop();
                transactionTraceArray[creatTraceIndex].action.to = nextTrace.action.addr;
                transactionTraceArray[creatTraceIndex].action.outcome = nextTrace.action.outcome;
            }
        }
        if(stack.length > 0){
            const creatTraceIndex = stack.pop();
            transactionTraceArray[creatTraceIndex].action.to = transaction.contractCreated;
        }
        return transactionTraceArray;
    }
}
