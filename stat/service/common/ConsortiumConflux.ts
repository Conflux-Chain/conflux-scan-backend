import {Conflux, CONST as SDK_CONST} from "js-conflux-sdk";
import {sleep} from "../tool/ProcessTool";
import {ConfluxOption} from "../../config/StatConfig";
import {isNumber} from "lodash";
import {makeIdV} from "../../model/HexMap";
import {CONST} from "./constant";

const lodash = require('lodash');
const formatter = require('js-conflux-sdk/src/rpc/types/formatter');

export class ConsortiumConflux extends Conflux{

    constructor(confluxOption: ConfluxOption) {
        super(confluxOption);
    }

    /*
        public chain
        /// Earliest epoch (true genesis)
        Earliest,
        /// The latest checkpoint (cur_era_genesis)
        LatestCheckpoint,
        ///
        LatestFinalized,
        /// The latest confirmed (with the estimation of the confirmation meter)
        LatestConfirmed,
        /// Latest block with state.
        LatestState,
        /// Latest mined block.
        LatestMined,
    */
    /*
        consortium chain
        ///Earliest epoch (genesis)
        Earliest,
        /// The latest checkpoint (cur_era_genesis)
        LatestCheckpoint,
        /// Latest block with state.
        LatestState,
        /// Latest block in candidate pivot tree.
        LatestCandidate,
    */
    async getEpochNumber(epochNumber = SDK_CONST.EPOCH_NUMBER.LATEST_STATE) {
        if(epochNumber === SDK_CONST.EPOCH_NUMBER.LATEST_MINED) {
            const latestState = await super.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_STATE);
            return latestState;
        }
        if(epochNumber === SDK_CONST.EPOCH_NUMBER.LATEST_CONFIRMED) {
            const latestState = await super.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_STATE);
            return latestState > 600 ? latestState - 600 : 0;
        }
        if(epochNumber === SDK_CONST.EPOCH_NUMBER.LATEST_FINALIZED) {
            const latestState = await super.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_STATE);
            return latestState > 800 ? latestState - 800 : 0;
        }


        if (epochNumber === SDK_CONST.EPOCH_NUMBER.LATEST_STATE
            || epochNumber === SDK_CONST.EPOCH_NUMBER.LATEST_CHECKPOINT
            || epochNumber === SDK_CONST.EPOCH_NUMBER.EARLIEST
            || isNumber(epochNumber)
        ) {
            return super.getEpochNumber(epochNumber);
        }
    }


    async getEpochReceipts(epochNumber) {
        return this.fetchEpochReceipts(this, epochNumber);
    }

    async getBlockRewardInfo(epochNumber) {
        return [];
    }

    // @ts-ignore
    async traceBlock(blockHash) {
        return {};
    }

    async traceTransaction(txHash) {
        return [];
    }

    // ========================== getEpochReceipts ===========================
    private async fetchEpochReceipts(confluxSdk, epochNumber) {
        do{
            // get raw data
            const [latestState, blockHashArray, block] = await Promise.all([
                confluxSdk.cfx.getEpochNumber('latest_state'),
                confluxSdk.cfx.getBlocksByEpochNumber(epochNumber)
                    .catch(err=>{ console.log(`fetchEpochReceipts epoch:${epochNumber} error:${err}`); return [];}),
                confluxSdk.cfx.getBlockByEpochNumber(epochNumber, false)
                    .catch(err=>{ console.log(`fetchEpochReceipts epoch:${epochNumber} error:${err}`); return null;}),
            ]);

            // pre validate
            if (latestState < epochNumber) {
                await sleep(1_000);
                console.log(`[epoch=${epochNumber}]fetchEpochReceipts, epoch not ready, latestState=${latestState}`);
                continue;
            }
            if (blockHashArray.length === 0 || block === null) {
                console.log(`[epoch=${epochNumber}]fetchEpochReceipts, block not ready, blocks ${blockHashArray.length}, pivot block ${block === null}`);
                continue;
            }
            const pivotBlockHash = block.hash;
            const lastBlockHash = blockHashArray[blockHashArray.length - 1];
            if (pivotBlockHash !== lastBlockHash) {
                console.log(`[epoch=${epochNumber}]fetchEpochReceipts, pivot block mismatch, pivotBlock=${pivotBlockHash} lastBlock=${lastBlockHash}`);
                continue;
            }

            // get tx hashes
            const txHashInEpoch = []; // 2d
            const blockArray = await this.batchFetchBlock(confluxSdk,  blockHashArray);
            for (const [blockIndex, block] of blockArray.entries()) {
                const txHashInBlock = [];
                for (const [txIndex, tx] of block.transactions.entries()) {
                    txHashInBlock.push(tx.hash);
                }
                txHashInEpoch.push(txHashInBlock);
            }

            // get tx receipts
            const txReceiptsInEpoch = []; // 2d
            for (const [blockIndex, txHashInBlock] of txHashInEpoch.entries()) {
                if(txHashInBlock.length === 0) {
                    txReceiptsInEpoch.push(txHashInBlock);
                    continue;
                }
                const txReceiptsInBlock = await this.batchFetchReceipt(confluxSdk, txHashInBlock);
                txReceiptsInEpoch.push(txReceiptsInBlock);
            }

            // rewrite mismatch receipts
            for(const [blockIndex, block] of blockArray.entries()){
                if(!block.transactions?.length) {
                    continue;
                }
                const txReceiptsInBlock = txReceiptsInEpoch[blockIndex];
                for (const [txIndex, tx] of block.transactions.entries()){
                    if (tx.status === null) {
                        const receipt = txReceiptsInBlock[txIndex];
                        receipt.epochNumber = block.epochNumber;
                        receipt.blockHash = block.hash;
                        receipt.outcomeStatus = 2;
                    }
                }
            }

            // post validate
            try{
                this.validate(epochNumber, blockArray, txReceiptsInEpoch);
            } catch (e) {
                console.log(`fetchEpochReceipts`, e);
                break;
            }

            return txReceiptsInEpoch;
        } while(true)
    }

    private async batchFetchReceipt(confluxSdk, txHashArray, doFormat= true){
        return confluxSdk.provider.batch(
            txHashArray.map(hash=>{
                return {"method": "cfx_getTransactionReceipt",
                    params: [hash]}
            })
        ).then(arr=>{
            if (doFormat) {
                this.formatReceipt(arr)
            }
            return arr
        })
    }

    private async batchFetchBlock(confluxSdk, blockHashArray, detail= true, doFormat= true){
        return confluxSdk.provider.batch(
            blockHashArray.map(hash=>{
                return {"method": "cfx_getBlockByHash",
                    params: [hash, detail]}
            })
        ).then(arr=>{
            if (doFormat) {
                this.formatBlock(arr)
            }
            return arr
        })
    }

    private validate(epoch, blockArray, receipts) {
        const revertBlockArray = blockArray.filter(block => block.epochNumber !== epoch);
        if(revertBlockArray.length && epoch !== 0){ // epochNumber of epoch=0 is null in consortium mode
            throw new Error(`[epoch=${epoch}]validate, mismatch epoch (blockArray:${JSON.stringify(blockArray)})`);
        }

        if (blockArray.length !== receipts.length && epoch !== 0) {
            throw new Error(`[epoch=${epoch}]validate, mismatch length (blocks, receipts)`);
        }

        for (const [blockIndex, block] of blockArray.entries()) {
            if (epoch === 0) {
                return;
            }
            if (block.transactions.length !== receipts[blockIndex].length) {
                throw new Error(`[epoch=${epoch}]validate, mismatch length (transactions, receipts)`);
            }
            for (const [txIndex, tx] of block.transactions.entries()) {
                tx.receipt = receipts[blockIndex][txIndex];
                const receiptStatus = tx.receipt?.outcomeStatus;
                if((receiptStatus === 0 || receiptStatus === 1) &&
                    (tx.receipt.blockHash !== tx.blockHash || tx.receipt.transactionHash !== tx.hash)){
                    throw new Error(`[epoch=${epoch}]validate, mismatch hash (transaction:${JSON.stringify(lodash.pick(tx.receipt, ['blockHash', 'transactionHash']))} receipt:${JSON.stringify(lodash.pick(tx, ['blockHash', 'hash']))})`);
                }
            }
        }
    }

    private formatBlock(blockArray) {
        blockArray.forEach((block, index)=>{
            blockArray[index] = formatter.block.$or(null)(block);
        })
    }

    private formatReceipt(receiptArray) {
        receiptArray.forEach((receipt, index)=>{
            receiptArray[index] = formatter.receipt.$or(null)(receipt);
        })
    }
}