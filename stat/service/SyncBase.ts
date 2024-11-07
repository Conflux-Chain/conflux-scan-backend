import {sleep} from "./tool/ProcessTool";
import {CONST} from "./common/constant"
import {batchFetchBlock} from "./common/utils";
import {Epoch} from "../model/Epoch";
import {StatApp} from "../StatApp";
import {Conflux, format} from "js-conflux-sdk";
import {makeIdV} from "../model/HexMap";
import {TransactionReceipt} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {FirstBlockNo, RpcCacheOption} from "../config/StatConfig";
import {loadMaxBlockEpoch} from "../model/FullBlock";
import {EpochHashCfxTransfer} from "../CfxTransferSync";
import {rmCache} from "./common/RpcCacheManager";
import { cfxSafeEpochReceipts } from "../TokenTransferSync";

const lodash = require('lodash');
const TOPICS_TO_TRACE = [[
    '0x14cb751d0950ff2788201931c45f715f7472443bc197311d9e3a7a0ba566b7e6', //TOPIC0_ANNOUNCE
    '0x516ccd4a0fb2b81543e6f874521a92f5db5ff281f362e243f7e99a292689211e', // TOPIC0_NAME_TAG_CHANGED
    '0xdf58130dfdd209d47be11d9978064ac9b114eb08c16df7855eb1d83be3f45a8c', // TOPIC0_LABEL_CHANGED
]];

export abstract class SyncBase{
    public static SYNC_BACKWARD = false;

    protected app: StatApp;
    private forwardQueue: PreloadMap;
    private backwardQueue: PreloadMap;
    protected debug: boolean

    private metric0 = {
        startEpoch: 0,
        currentEpoch: 0,
    };
    private m0(step, startTime){
        if(!this.debug) {
            return
        }

        const runTimes = this.metric0[step];
        const elapsedTime = this.metric0[`${step}_ms`];
        const elapsedDelta = Date.now() - startTime;
        this.metric0[step] = runTimes === undefined ? 1 : runTimes + 1;
        this.metric0[`${step}_ms`] = elapsedTime === undefined ? elapsedDelta : (elapsedTime + elapsedDelta);

        const epochDelta = this.metric0.currentEpoch - this.metric0.startEpoch
        if(epochDelta > 0 && epochDelta % 1000 === 0) {
            console.log(`metrics0-----------------------------------`);
            console.log(JSON.stringify(this.metric0));
            console.log(`------------------------------------------`);
            this.metric0 = {
                startEpoch: 0,
                currentEpoch: 0
            };
        }

        return Date.now();
    }

    protected constructor(app: StatApp) {
        this.app = app;
        this.forwardQueue = new PreloadMap(this.getData.bind(this));
        this.backwardQueue = new PreloadMap(this.getData.bind(this));
    }

    private async getDataForwardWithPreload(epochNumber): Promise<SyncData> {
        const {
            app: { cfx, config },
        } = this;

        const stateEpochNumber = await loadMaxRefEpoch(cfx);
        lodash.range(config.preload).forEach((i) => {
            if (epochNumber + i < stateEpochNumber) {
                this.forwardQueue.start(epochNumber + i);
            }
        });
        return this.forwardQueue.pop(epochNumber);
    }

    private async getDataBackwardWithPreload(epochNumber): Promise<SyncData> {
        const {
            app: { config },
        } = this;

        lodash.range(config.preload).forEach((i) => {
            if (epochNumber - i >= 0) {
                this.backwardQueue.start(epochNumber - i);
            }
        });
        return this.backwardQueue.pop(epochNumber);
    }

    private async saveForward(epochNumber, { parentHash, modelData }: SyncData): Promise<SyncCode> {
        const preEpochNumber = epochNumber - 1;
        let s = Date.now();
        const prevEpoch = await this.getEpochByEpochNumber(preEpochNumber);
        s = this.m0('EpochByNumber', s)
        const validate = await this.validate(epochNumber, modelData);
        s = this.m0('Validate', s)
        if (prevEpoch && parentHash !== prevEpoch.pivotHash || !validate) {
            console.log(`saveForward reorg ${JSON.stringify({epochNumber, preEpochNumber, prevEpoch, validate, code: SyncCode.PIVOT_SWITCH})}`)
            s = this.m0('PivotHash', s)
            return SyncCode.PIVOT_SWITCH;
        }
        s = Date.now();
        await this.save(epochNumber, modelData);
        s = this.m0('SaveBase', s)
        return SyncCode.SUCCESS;
    }

    private async saveBackward(epochNumber, { pivotHash, modelData }: SyncData): Promise<SyncCode> {
        const nextEpochNumber = epochNumber + 1;
        /*const nextEpoch = await this.getEpochByEpochNumber(nextEpochNumber);*/
        const nextEpoch = await this.getEpoch(nextEpochNumber);
        const validate = await this.validate(epochNumber, modelData);
        if (nextEpoch && pivotHash !== nextEpoch.parentHash || !validate) {
            return SyncCode.PIVOT_SWITCH;
        }
        await this.save(epochNumber, modelData);
        return SyncCode.SUCCESS;
    }

    private async syncForward(epochNumber) {
        let syncCode;
        let data: SyncData;

        if(this.metric0.startEpoch === 0) {
            this.metric0.startEpoch = epochNumber
        }
        let s = Date.now();
        try {
            data = await this.getDataForwardWithPreload(epochNumber);
            s = this.m0('Preload', s)
            if(data.syncCode === SyncCode.RETRY) {
                console.log(`[epoch=${epochNumber}]sync_forward fetch,retry: ${data.message}`);
                s = Date.now();
                await sleep(10_000);
                s = this.m0('Sleep-1', s)
                return epochNumber;
            }
        } catch (e) {
            console.log(`[epoch=${epochNumber}]sync_forward fetch,error:`, e);
            s = Date.now();
            await sleep(10_000);
            s = this.m0('Sleep-2', s)
            return epochNumber;
        }
        try {
            s = Date.now();
            syncCode = await this.saveForward(epochNumber, data);
            s = this.m0('Save', s)
        } catch (e) {
            console.log(`[epoch=${epochNumber}]sync_forward sync,error:`, e);
            s = Date.now();
            await sleep(10_000);
            s = this.m0('Sleep-3', s)
            return epochNumber;
        }

        if(syncCode === SyncCode.SUCCESS){
            epochNumber += 1;
        }
        if(syncCode === SyncCode.PIVOT_SWITCH){
            s = Date.now();
            await this.forwardQueue.clear();
            s = this.m0('Clear', s)
            epochNumber -= 1;
            await this.delete(epochNumber, data.modelData).catch((e) => {
                console.log(`[epoch=${epochNumber}]sync_forward del,error`, e);
                throw e;
            });
            s = this.m0('Delete', s)
        }
        s = Date.now();
        this.metric0.currentEpoch = epochNumber
        s = this.m0('Dummy', s)

        return epochNumber;
    }

    private async syncBackward(epochNumber) {
        let syncCode;
        let data: SyncData;
        try {
            data = await this.getDataBackwardWithPreload(epochNumber);
            if(data.syncCode === SyncCode.RETRY) {
                console.log(`[epoch=${epochNumber}]sync_backward fetch,retry:${data.message}`);
                await sleep(10_000);
                return epochNumber;
            }
        } catch (e) {
            console.log(`[epoch=${epochNumber}]sync_backward fetch,error:`, e);
            await sleep(10_000);
            return epochNumber;
        }

        try {
            syncCode = await this.saveBackward(epochNumber, data);
        } catch (e) {
            console.error(`[epoch=${epochNumber}]sync_backward sync,error:`, e);
            await sleep(10_000);
            return epochNumber;
        }

        if(syncCode === SyncCode.SUCCESS){
            epochNumber -= 1;
        }
        return epochNumber;
    }

    public async run(epochNumber) {
        const {
            app: { cfx, config },
        } = this;
        if (!Number.isInteger(config.preload)) {
            console.log(` SyncBase uses default preload value: 16.`)
            config.preload = 16
        }

        const that = this
        if (SyncBase.SYNC_BACKWARD) {
            let traceEpochNumber = Number.isInteger(config.syncEpochNumberBackward) ? config.syncEpochNumberBackward
                : (await that.getEpochNumberBackward());
            async function repeat() {
                if (traceEpochNumber >= 0) {
                    traceEpochNumber = await that.syncBackward(traceEpochNumber);
                    setTimeout(repeat, 0)
                }
            }
            return repeat()
        }

        const next = await this.getNextEpochNumber();
        let traceEpochNumber = epochNumber;
        if(traceEpochNumber === undefined || traceEpochNumber <= next){
            traceEpochNumber = next;
        }

        let stateEpochNumber = await loadMaxRefEpoch(cfx).catch(e => {
            console.log(` SyncBase getEpochNumber error:${e}`);
            return 0;
        });

        async function repeat() {
            if (traceEpochNumber <= stateEpochNumber - (config.preload)) {
                traceEpochNumber = await that.syncForward(traceEpochNumber);
                setTimeout(repeat, 0)
            } else {
                stateEpochNumber = await loadMaxRefEpoch(cfx).catch(e => {
                    console.log(` SyncBase getEpochNumber error:${e}`);
                    return 0;
                });
                setTimeout(repeat, 5_000)
            }
        }
        return repeat()
    }

    //---------------------- business method for epoch -----------------------
    public async getEpochData(epochNumber) {
        const {
            app: { cfx },
        } = this;

        const [latestState, blockHashArray, receipts] = await Promise.all([
            loadMaxRefEpoch(cfx), // query db, cache data was made by full block sync
            // cfx.getEpochNumber('latest_state'),
            cfx.getBlocksByEpochNumber(epochNumber)
                /*.catch(err=>{ console.log(`epoch-sync.getBlocks epoch:${epochNumber} error:${err}`); return [];})*/,
            cfxSafeEpochReceipts(cfx, epochNumber)
                .then(res=>{ if (epochNumber === 0) res = []; return res;})
                /*.catch(err=>{ console.log(`epoch-sync.getReceipts epoch:${epochNumber} error:${err}`); return [];})*/,
        ]);

        if (latestState < epochNumber) {
            await sleep(1000);
            throw new Error(`[epoch=${epochNumber}]not ready, latestState=${latestState}`);
        }
        if (blockHashArray.length === 0) {
            throw new Error(`[epoch=${epochNumber}]no block`);
        }
        if (epochNumber != 0 && receipts === null) {
            throw new Error(`[epoch=${epochNumber}]not ready, receipts is null`);
        }
        const blockArray = await batchFetchBlock(cfx,  blockHashArray, null, epochNumber);
        if (epochNumber !== 0 && blockArray.length !== receipts.length && epochNumber !== 0) {
            throw new Error(`[epoch=${epochNumber}]mismatch between blocks and receipts`);
        }

        const transactionArray = []
        const transactionHashArray = [];
        for (const [blockIndex, block] of blockArray.entries()) {
            if (epochNumber === 0) {
                break;
            }
            if (block.transactions.length !== receipts[blockIndex].length) {
                throw new Error(`[epoch=${epochNumber}]mismatch between transactions and receipts`);
            }
            // @ts-ignore
            for (const [txIndex, tx] of block.transactions.entries()) {
                tx.receipt = receipts[blockIndex][txIndex];
                const receiptStatus = tx.receipt?.outcomeStatus;
                if((receiptStatus === 0 || receiptStatus === 1) &&
                    (tx.receipt.blockHash !== tx.blockHash || tx.receipt.transactionHash !== tx.hash)){
                    throw new Error(`[epoch=${epochNumber}]mismatch between
                    transaction:${JSON.stringify(lodash.pick(tx.receipt, ['blockHash', 'transactionHash']))} and
                    receipt:${JSON.stringify(lodash.pick(tx, ['blockHash', 'hash']))}`);
                }
                transactionArray.push(tx);
                transactionHashArray.push(tx.receipt.transactionHash);
            }
        }

        const pivotBlock = blockArray[blockArray.length -1];
        const epoch = {
            epoch: epochNumber,
            pivotHash: pivotBlock.hash.substr(2),
            parentHash: pivotBlock.parentHash.substr(2),
            blockHeight: pivotBlock.height,
            timestamp: new Date(pivotBlock.timestamp * 1000),
        };

        return {epoch, latestState, blockHashArray, blockArray, transactionArray, transactionHashArray, receipts};
    }

    //------------------------------- event log ------------------------------
    public async decodeLogFromReceipts(epochNumber, receipts2d: TransactionReceipt[][], blockHashes:string[]) {
        const {
            app: { tokenTool },
        } = this;

        const groupedLogs = {
            epochNumber,
            announcementArray: [],
            nameTagArray: [],
            labelArray: [],
            byte32NameTagArray: [],
        };

        let blockIdx = -1;
        for (let receiptsInBlock of receipts2d) {
            blockIdx ++

            for (let txReceipt of receiptsInBlock) {
                if (txReceipt.outcomeStatus !== 0) {
                    continue;
                }

                if (txReceipt.blockHash !== blockHashes[blockIdx]) {
                    throw new Error(`tx receipt has mismatch block hash, epoch ${txReceipt.epochNumber
                    }, ${txReceipt.blockHash
                    } vs block hashes ${blockHashes[blockIdx]}`)
                }

                for (let log of txReceipt.logs) {
                    let transfer;
                    if ((transfer = tokenTool.decodeAnnouncePlus(log))) {
                        groupedLogs.announcementArray.push(transfer)
                    } else if ((transfer = tokenTool.decodeNameTagChanged(log))) {
                        groupedLogs.nameTagArray.push(transfer)
                    } else if ((transfer = tokenTool.decodeLabelChanged(log))) {
                        groupedLogs.labelArray.push(transfer)
                    } else if ((transfer = tokenTool.decodeBytes32NameTagChanged(log))) {
                        groupedLogs.byte32NameTagArray.push(transfer)
                    }
                }
            }
        }

        return groupedLogs
    }

    public async getLogsGrouped({epochNumber, epochTimestamp}) {
        const {
            app: { tokenTool },
        } = this;

        const eventLogArray = await this.getLogs({epochNumber, epochTimestamp});
        const groupedLogs = {
            epochNumber,
            announcementArray: [],
            nameTagArray: [],
            labelArray: [],
        };

        for(const eventLog of eventLogArray) {
            const [announcement, nameTag, label] = await Promise.all([
                tokenTool.decodeAnnouncePlus(eventLog),
                tokenTool.decodeNameTagChanged(eventLog),
                tokenTool.decodeLabelChanged(eventLog),
            ]);
            if(announcement) {groupedLogs.announcementArray.push(announcement);}
            if(nameTag) {groupedLogs.nameTagArray.push(nameTag);}
            if(label) {groupedLogs.labelArray.push(label);}
        }
        return groupedLogs;
    }

    private async getLogs({epochNumber, epochTimestamp}) {
        const {
            app: { cfx },
        } = this;

        const eventLogArray = await cfx.getLogs({
            fromEpoch: epochNumber,
            toEpoch: epochNumber,
            // @ts-ignore
            topics: TOPICS_TO_TRACE,
        }).catch(async err=>{
            const msg = `${err}`
            if (msg.includes('expected a numbers with less than largest epoch number.')) {
                const latest = await cfx.getEpochNumber('latest_state');
                console.log(`epoch-sync.eventLogArray epoch:${epochNumber} latestState:${latest} not executed`)
            } else {
                throw new Error(`[epoch=${epochNumber}]getLogs retry: ${msg}`);
            }
            return [];
        });

        return [...eventLogArray].map((v) => SyncBase.parseEventLog(v));
    }

    private static parseEventLog(eventLog) {
        eventLog.epochNumber = Number(eventLog.epochNumber);
        eventLog.address = format.hexAddress(eventLog.address);
        eventLog.transactionLogIndex = Number(eventLog.transactionLogIndex);
        return eventLog;
    }

    //---------------------------- token transfer ----------------------------
    public async getTokenTransferArrayDB(epochTimestamp, blockHashArray, {transfer20Array, transfer721Array,
        transfer1155Array}, byRcpt = false) {
        const {
            ADDRESS_TRANSFER_TYPE: {ERC20, ERC721, ERC1155}
        } = CONST;

        const blockHashMap = {};
        lodash.forEach(blockHashArray, (blockHash, index) => blockHashMap[blockHash] = index);

        let result = [];
        const tsArray = [
            {list: transfer20Array, type: ERC20.code},
            {list: transfer721Array, type: ERC721.code},
            {list: transfer1155Array, type: ERC1155.code},
        ];
        for (const ts of tsArray) {
            if(!ts.list.length){
                continue;
            }
            result = [...result, ...await SyncBase.buildTokenTransferArray(ts.type, ts.list, epochTimestamp, blockHashMap, byRcpt)];
        }
        return result;
    }

    public static async buildTokenTransferArray(type, transferArray, epochTimestamp, blockHashMap, byRcpt = false){
        const result = [];
        for (const item of transferArray) {
            const transfer = {} as any;
            transfer.epoch = byRcpt ? item.epoch : item.epochNumber;
            transfer.blockIndex = byRcpt ? item.blockIndex : blockHashMap[item.blockHash];
            transfer.txIndex = item.transactionIndex;
            transfer.txLogIndex = item.transactionLogIndex;
            transfer.batchIndex = item.batchIndex;

            const [fromId, toId, contractId] = await Promise.all([
                makeIdV(item.from, undefined, {dt:epochTimestamp}),
                makeIdV(item.to, undefined, {dt:epochTimestamp}),
                makeIdV(item.address, undefined, {dt:epochTimestamp}),
            ]);
            transfer.fromId = fromId;
            transfer.toId = toId;
            transfer.contractId = contractId;
            transfer.tokenId = `${item.tokenId || 0}`;
            transfer.value = item.value?.toString();

            transfer.type = type;
            transfer.createdAt = epochTimestamp;
            result.push(lodash.defaults(transfer, {batchIndex: 0, tokenId: 0, value: 1}));
        }
        return result;
    }

    //-------------------- methods subclass to implement ---------------------
    public abstract getData(epochNumber): Promise<SyncData>;

    public abstract save(epochNumber, modelData);

    public abstract delete(epochNumber, modelData);

    public async getNextEpochNumber(){
        let maxEpochNumber:number = await Epoch.max('epoch')
        return maxEpochNumber ? (maxEpochNumber + 1) : FirstBlockNo;
    }

    public async getEpochByEpochNumber(epochNumber){
        return await Epoch.findOne({where:{epoch: epochNumber}});
    }

    public async validate(epochNumber, modelData) {
        const blockArray = modelData.blockArray;
        const revertBlockArray = blockArray.filter(block => block.epochNumber !== epochNumber);
        if(revertBlockArray.length && epochNumber !== 0){ // epochNumber is null in epoch 0 under consortium mode
            console.log(`epoch-sync.validate epoch:${epochNumber}, minerBlockArray:${JSON.stringify(blockArray)}`)
            await rmCache(this.app.cfx.provider.conf.cachePath, epochNumber, true)
            return Promise.resolve(false);
        }

        return Promise.resolve(true);
    }

    //---------------------- methods for sync backward  -----------------------
    public abstract getEpochNumberBackward(): Promise<number>;

    public abstract getEpoch(epochNumber): Promise<any>;
}

export class SyncData {
    syncCode: SyncCode;
    message?: string;
    parentHash?: string;
    pivotHash?: string;
    modelData?: any;
}

export class PreloadMap extends Map {
    private func: any;
    constructor(func) {
        super();
        this.func = func;
    }

    public start(arg) {
        if (!this.has(arg)) {
            this.set(arg, this.func(arg).catch((e) => e));
        }
        return this.get(arg);
    }

    public async pop(arg) {
        const task = this.start(arg);
        this.delete(arg);

        const value = await task;
        if (value instanceof Error) {
            throw value;
        }
        return value;
    }
}

async function loadMaxRefEpoch(cfx: Conflux) {
    const conf: RpcCacheOption = cfx.provider.conf;
    if (conf?.readTraceCache) {
        // trace cache was make by cfx transfer sync
        return EpochHashCfxTransfer.findOne({order: [['epoch', 'desc']]}).then(res=>{
            return res?.epoch || 0
        }).then(res=>{
            if (res % 1000 == FirstBlockNo) {
                console.log(`ref to cfx transfer sync, update cursor to `, res)
            }
            return res;
        })
    } else if (conf?.readCache) {
        return loadMaxBlockEpoch(0).then(res=>{
            if (res % 1000 == FirstBlockNo) {
                console.log(`ref to block sync, update cursor to `, res)
            }
            return res;
        })
    }
    // do not depend on any cache, fetch from rpc.
    return cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE).then(res=>{
        if (res % 1000 == FirstBlockNo) {
            console.log(`ref to block chain, update cursor to `, res)
        }
        return res;
    });
}

export enum SyncCode {
    SUCCESS,
    FAILURE,
    PIVOT_SWITCH,
    RETRY
}
