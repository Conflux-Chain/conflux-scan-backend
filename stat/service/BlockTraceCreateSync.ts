// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {KEY_BLOCK_TRACE_CREATE_EPOCH, KV} from "../model/KV";
import {makeId} from "../model/HexMap";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {fmtDtUTC} from "../model/Utils";
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
        const isSuccess = await this.syncByEpoch(curEpoch)
        if (isSuccess) {
            await KV.update({value: curEpoch.toString()}, {where: {key: KEY_BLOCK_TRACE_CREATE_EPOCH}})
        }
    }

    private async syncByEpoch(epochNumber: number) : Promise<boolean>{
        const traceCreateArray = await this.getTraceCreateArray(epochNumber);
        const blockDt = traceCreateArray.length > 0 ? new Date(traceCreateArray[0].blockTime*1000) : undefined
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
            await TraceCreateContract.create(toCreate)
        }
        if (epochNumber % 100 === 0) {
            const count = traceCreateArray.length;
            console.log(`${fmtDtUTC(new Date())} insert ${count} trace_create_contract at epoch:${epochNumber}`)
        }
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
        const traceArray = [];
        const blockArray = await this.getBlockArray(epochNumber);
        await Promise.all(blockArray.map(async (block) => {
            if (!block.transactions.length) {
                return;
            }

            const blockTrace:any[] = await this.cfx.traceBlock(block.hash);
            if (!blockTrace) {
                console.error(`trace_create_contract no trace at block:${block.hash}`);
                return traceArray;
            }

            //assemble traces
            // @ts-ignore
            lodash.zip(block.transactions, blockTrace.transactionTraces)
                .forEach(([transaction, transactionTracesItem], transactionIndex) => {
                    transactionTracesItem.traces.forEach((trace, transactionTraceIndex) => {
                        const parsedTrace = {
                            epochNumber: block.epochNumber,
                            blockHash: block.hash,
                            blockTime: block.timestamp,
                            transactionHash: transaction.hash,
                            transactionIndex,
                            transactionTraceIndex,
                            status: transaction.status,
                            ...this.parseTraceAllType(trace, transactionTraceIndex, transactionTracesItem.traces, transaction),
                        };
                        traceArray.push(parsedTrace);
                    });
                });
        }));
        return traceArray;
    }

    async getBlockArray(epochNumber) {
        const blockHashArray = await this.cfx.getBlocksByEpochNumber(epochNumber);
        const blockArray = await Promise.all(blockHashArray.map(async (blockHash) => {
            return this.cfx.getBlockByHash(blockHash, true);
        }));
        return blockArray.map((v) => this.parseBlock(v, true));
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

    private parseTraceAllType(trace, transactionTraceIndex, traces, transaction) {
        if (trace.action.from) {
            trace.action.from = format.hexAddress(trace.action.from);
        }
        if (trace.action.value) {
            trace.action.value = BigInt(trace.action.value);
        }
        if (trace.action.to) {
            trace.action.to = format.hexAddress(trace.action.to);
        }
        if (trace.type === CONST.TRACE_TYPE.CREATE) {
            let nextCreateTrace;
            // eslint-disable-next-line no-plusplus
            for (let i = transactionTraceIndex + 1; i < traces.length; i++) {
                const nextTrace = traces[i];
                if (nextTrace.type === CONST.TRACE_TYPE.CREATE || nextTrace.type === CONST.TRACE_TYPE.CREATE_RESULT) {
                    nextCreateTrace = nextTrace;
                    break;
                }
            }
            if (nextCreateTrace === undefined || nextCreateTrace.type === CONST.TRACE_TYPE.CREATE) {
                trace.action.to = transaction.contractCreated;
            } else if (nextCreateTrace.type === CONST.TRACE_TYPE.CREATE_RESULT) {
                trace.action.to = format.hexAddress(nextCreateTrace.action.addr);
                trace.action.outcome = nextCreateTrace.action.outcome;
            }
        }
        return trace;
    }
}
