import {sleep} from "./tool/ProcessTool";
import {CONST} from "./common/constant"
import {batchFetchBlock} from "./common/utils";
import {Epoch} from "../model/Epoch";
import {makeIdV} from "../model/HexMap";
import {TransactionReceipt} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {FirstBlockNo, NoCoreSpace, RpcCacheOption} from "../config/StatConfig";
import {FullBlock, loadMaxBlockEpoch} from "../model/FullBlock";
import {EpochHashCfxTransfer} from "../CfxTransferSync";
import {cfxSafeEpochReceipts} from "../TokenTransferSync";
import {CfxTransfer} from "../model/CfxTransfer";
import {CONST as SDK_CONST} from "js-conflux-sdk";
import {fmtDtUTC} from "../model/Utils";
import {Measure} from "./common/Measure";

const lodash = require('lodash');

const PRELOAD_SIZE_NORMAL = 8
const PRELOAD_SIZE_CATCHUP = 50

export abstract class SyncBase {
    private epochLatestState: number
    private preloadSize: number = PRELOAD_SIZE_CATCHUP
    private forwardQueue: PreloadMap
    protected app: any
    protected catchUp: CatchUp
    protected measure: Measure

    protected constructor(app: any) {
        this.app = app;
        this.forwardQueue = new PreloadMap(this.getData.bind(this));
        this.catchUp = new CatchUp(app, this)
        this.measure = new Measure()
    }

    private async getDataForwardWithPreload(epochNumber: number): Promise<SyncData> {
        const stateEpochNumber = this.epochLatestState
        lodash.range(this.preloadSize).forEach((i) => {
            if (epochNumber + i < stateEpochNumber) {
                this.forwardQueue.start(epochNumber + i);
            }
        });
        return this.forwardQueue.pop(epochNumber);
    }

    private async saveForward(epochNumber, {parentHash, modelData}: SyncData): Promise<SyncCode> {
        if(!this.catchUp.status()) {
            const preEpochNumber = epochNumber - 1
            const prevEpoch = await this.epochByEpochNumber(preEpochNumber)
            if (prevEpoch && parentHash !== prevEpoch.pivotHash) {
                console.log(`saveForward reorg ${JSON.stringify({
                    epochNumber,
                    preEpochNumber,
                    prevEpoch,
                    code: SyncCode.PIVOT_SWITCH
                })}`)
                return SyncCode.PIVOT_SWITCH
            }
        }

        await this.save(epochNumber, modelData)

        return SyncCode.SUCCESS
    }

    private async syncForward(epochNumber) {
        let syncCode;
        let data: SyncData;

        try {
            data = await this.measure.call('preload', () => this.getDataForwardWithPreload(epochNumber))
        } catch (e) {
            console.log(`[epoch=${epochNumber}]sync_forward fetch error:`, e);
            await sleep(10_000);
            return epochNumber;
        }

        if (data.syncCode === SyncCode.RETRY) {
            console.log(`[epoch=${epochNumber}]sync_forward fetch retry: ${data.message}`);
            await sleep(10_000);
            return epochNumber;
        }

        try {
            syncCode = await this.measure.call('save', () => this.saveForward(epochNumber, data))
        } catch (e) {
            console.log(`[epoch=${epochNumber}]sync_forward save error:`, e);
            await sleep(10_000);
            return epochNumber;
        }

        const catchup = this.catchUp.status()
        if (epochNumber % (catchup ? 1000 : 100) === 0) {
            console.log(`${fmtDtUTC(new Date())} Catch-up mode: ${catchup}, latest epoch ${epochNumber}`)
            catchup && this.measure.dump(`${epochNumber}`, 1, 'wait', 'save')
        }

        if (syncCode === SyncCode.SUCCESS) {
            epochNumber += 1;
        }

        if (syncCode === SyncCode.PIVOT_SWITCH) {
            this.forwardQueue.clear();
            epochNumber -= 1;
            await this.delete(epochNumber, data.modelData).catch((e) => {
                console.log(`[epoch=${epochNumber}]sync_forward del error:`, e);
                throw e;
            });
        }

        return epochNumber;
    }

    public async run() {
        let epoch = await this.nextEpochNumber()

        epoch = lodash.max([epoch, this.app?.config?.syncEpochNumber])

        let latestStateEpoch = this.epochLatestState

        const that = this
        async function repeat() {
            if (epoch <= latestStateEpoch - (that.preloadSize)) {
                epoch = await that.measure.taskWait('wait', () => that.syncForward(epoch))
                setTimeout(repeat, 0)
            } else {
                latestStateEpoch = that.epochLatestState
                setTimeout(repeat, 5_000)
            }
        }

        return repeat()
    }

    //---------------------- business method for epoch -----------------------
    public async getEpochData(epochNumber) {
        const {
            app: {cfx},
        } = this;

        const [latestState, blockHashArray, receipts] = await Promise.all([
            this.epochLatestState,
            cfx.getBlocksByEpochNumber(epochNumber)
                .catch(() => {return []}),
            cfxSafeEpochReceipts(cfx, epochNumber)
                .then(res => {
                    if (epochNumber === 0) res = [];
                    return res;})
                .catch(() => {return []})
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
        const blockArray = await batchFetchBlock(cfx, blockHashArray, null, epochNumber);
        if (epochNumber !== 0 && blockArray.length !== receipts.length) {
            throw new Error(`[epoch=${epochNumber}]mismatch between blocks and receipts`);
        }
        const revertBlockArray = blockArray.filter(block => block.epochNumber !== epochNumber);
        if (revertBlockArray.length && epochNumber !== 0) { // epochNumber is null in epoch 0 under consortium mode
            throw new Error(`[epoch=${epochNumber}]mismatch between blocks' epochNumber and target epochNumber`);
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
                if ((receiptStatus === 0 || receiptStatus === 1) &&
                    (tx.receipt.blockHash !== tx.blockHash || tx.receipt.transactionHash !== tx.hash)) {
                    throw new Error(`[epoch=${epochNumber}]mismatch between
                    transaction:${JSON.stringify(lodash.pick(tx.receipt, ['blockHash', 'transactionHash']))} and
                    receipt:${JSON.stringify(lodash.pick(tx, ['blockHash', 'hash']))}`);
                }
                transactionArray.push(tx);
                transactionHashArray.push(tx.receipt.transactionHash);
            }
        }

        const pivotBlock = blockArray[blockArray.length - 1];
        const epoch = {
            epoch: epochNumber,
            pivotHash: pivotBlock.hash.substr(2),
            parentHash: pivotBlock.parentHash.substr(2),
            blockHeight: pivotBlock.height,
            timestamp: new Date(pivotBlock.timestamp * 1000),
        };

        return {epoch, latestState, blockHashArray, blockArray, transactionArray, transactionHashArray, receipts};
    }

    private async nextEpochNumber() {
        let maxEpochNumber: number = await Epoch.max('epoch')
        return maxEpochNumber ? (maxEpochNumber + 1) : FirstBlockNo;
    }

    private async epochByEpochNumber(epochNumber) {
        return Epoch.findOne({where: {epoch: epochNumber}});
    }

    //------------------------- flush latest epoch ---------------------------
    public async scheduleLatestEpoch(delay: number = 10) {
        console.log(`schedule latest epoch, interval: ${delay}`)

        await this.latestStateEpoch()

        const that = this
        async function repeat() {
            await that.latestStateEpoch().catch(err => {
                console.log(`schedule latest epoch error:${err}`)
            })
            setTimeout(repeat, delay)
        }

        repeat().then()
    }

    private async latestStateEpoch() {
        const {
            app: {cfx},
        } = this

        let result: any
        const conf: RpcCacheOption = cfx.provider.conf
        if (conf?.readCache) {
            await loadMaxBlockEpoch(0).then(epoch => {result = {epoch, table: FullBlock.getTableName()}})
        } else if (conf?.readTraceCache) {
            await EpochHashCfxTransfer.findOne({order: [['epoch', 'desc']]})
                .then(r => {result = {epoch: r?.epoch || 0, table: CfxTransfer.getTableName()}})
        } else {
            await cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE).then(epoch => {result = {epoch}})
        }

        this.epochLatestState = result.epoch

        if (result.epoch % 1000 === 0 && result.table) {
            console.log(`latest state epoch ${result.epoch} from ${result.table}`)
        }
    }

    //------------------------------- event log ------------------------------
    public async decodeLogFromReceipts(epochNumber, receipts2d: TransactionReceipt[][], blockHashes: string[]) {
        const {
            app: {tokenTool},
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
            blockIdx++

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

    //---------------------------- token transfer ----------------------------
    public async getTokenTransferArrayDB(epochTimestamp, blockHashArray, {
        transfer20Array, transfer721Array,
        transfer1155Array
    }, byRcpt = false) {
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
            if (!ts.list.length) {
                continue;
            }
            result = [...result, ...await SyncBase.buildTokenTransferArray(ts.type, ts.list, epochTimestamp, blockHashMap, byRcpt)];
        }
        return result;
    }

    public static async buildTokenTransferArray(type, transferArray, epochTimestamp, blockHashMap, byRcpt = false) {
        const result = [];
        for (const item of transferArray) {
            const transfer = {} as any;
            transfer.epoch = byRcpt ? item.epoch : item.epochNumber;
            transfer.blockIndex = byRcpt ? item.blockIndex : blockHashMap[item.blockHash];
            transfer.txIndex = item.transactionIndex;
            transfer.txLogIndex = item.transactionLogIndex;
            transfer.batchIndex = item.batchIndex;

            const [fromId, toId, contractId] = await Promise.all([
                makeIdV(item.from, undefined, {dt: epochTimestamp}),
                makeIdV(item.to, undefined, {dt: epochTimestamp}),
                makeIdV(item.address, undefined, {dt: epochTimestamp}),
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
}

export class CatchUp {
    private app: any
    private syncer: any

    private catchingUp: boolean = true
    private finalizedEpoch: number = 0

    private accumulatedSize: number = 0
    private batchSizeOnSave: number = 100
    private batchData: BatchData

    public constructor(app: any, syncer: any) {
        this.app = app
        this.syncer = syncer
        this.batchData = new BatchData()
    }

    public status(): boolean {
        return this.catchingUp
    }

    public data(): BatchData {
        return this.batchData.data()
    }

    // only enqueue data which finalized already
    public async enqueue(data: ModelData, voteParamArray) {
        const result = {
            needStore: false,
            catchingUp: await this.checkStatus(data.epoch.epoch)
        }

        // catchup already and BatchData hold some data，the data of the epoch will not be enqueued
        // return {needStore: true, catchMode: false} when BatchData holds some data v
        // return {needStore: false, catchMode: false} when BatchData holds no data  v
        if(!result.catchingUp) {
            result.needStore = this.dataSize() > 0
            return result
        }

        // catchup mode
        // return {needStore: true, catchMode: true} when accumulated to batch size to save v
        // return {needStore: false, catchMode: true} when accumulate size not up to batch size
        this.cacheData(data, voteParamArray)
        result.needStore = this.needStore()
        return result
    }

    public reset() {
        this.batchData.reset()
        this.accumulatedSize = 0
    }

    /**
     * @param epoch epoch number to sync
     *
     * @return status
     *      true when in catchup mode
     *      false when catchup already
     */
    private async checkStatus(epoch: number): Promise<boolean> {
        if (!this.catchingUp) { // catchup already
            return false
        }

        if (epoch <= this.finalizedEpoch - (NoCoreSpace ? this.batchSizeOnSave : 0)) { // in catchup mode
            return true
        }

        return this.latestStatus(epoch)
    }

    private async latestStatus(epoch) {
        const {
            app: {cfx},
        } = this

        this.finalizedEpoch = await cfx.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_FINALIZED)
        this.catchingUp = epoch <= this.finalizedEpoch - (NoCoreSpace ? this.batchSizeOnSave : 0);

        if(!this.catchingUp) {
            this.syncer.preloadSize = PRELOAD_SIZE_NORMAL
            console.log(`${fmtDtUTC(new Date())} Catch-up done, epoch ${this.finalizedEpoch}`)
        }

        return this.catchingUp
    }

    private cacheData(data: ModelData, voteParamArray) {
        this.accumulatedSize ++
        this.batchData.enqueue(data, voteParamArray)
    }

    private needStore() {
        return this.dataSize() >= this.batchSizeOnSave
    }

    private dataSize() {
        return this.accumulatedSize
    }
}

export class SyncData {
    syncCode: SyncCode;
    message?: string;
    parentHash?: string;
    pivotHash?: string;
    modelData?: any;
}

export class PreloadMap extends Map {
    private func: Function;
    maxId: number = 0;
    limit: number;

    constructor(func, _limit = 10) {
        super();
        this.func = func;
        this.limit = _limit;
    }

    public start(arg: number) {
        if (isNaN(arg)) {
            console.log(`who call it ? `, new Error("stack is "))
        }
        if (!this.has(arg)) {
            if (arg > this.maxId) {
                this.maxId = arg;
            }
            const task = this.func(arg).catch((e: any) => e);
            this.set(arg, task);
            return task;
        }
        return this.get(arg);
    }

    public initTasks(first: number, count: number) {
        for (let i = 0; i < count; i++) {
            this.start(first++);
        }
    }

    public startNext() {
        if (this.size > this.limit) {
            return;
        }
        this.start(this.maxId + 1);
    }

    public async pop(arg: number) {
        const task = this.get(arg) ?? this.start(arg);
        this.delete(arg);

        const value = await task;
        if (value instanceof Error) {
            throw value;
        }
        return value;
    }
}

export enum SyncCode {
    SUCCESS,
    FAILURE,
    PIVOT_SWITCH,
    RETRY
}

export class ModelData{
    epoch: any = {}
    minerBlockArray = []
    addrTransferArray = []
    epochAddrIdArray = []
    nftTransferArray = []
    addrNftTransferArray = []
    addressNfts: any = {}
    voteParamArray = []

    announcedTokenArray = []
    announcedContractArray = []
    evmAddressArray = []
    traceCreateArray = []
    adminDestroyTxArray = []
    transferredNftArray = []
    tokenArray = []
    nameTagArray = []
    bytes32NameTagArray = []

    censorItemArray = []

    blockArray = []
    transactionArray = []

    public reset() {
        this.epoch = {}
        this.minerBlockArray = []
        this.addrTransferArray = []
        this.epochAddrIdArray = []
        this.nftTransferArray = []
        this.addrNftTransferArray = []
        this.addressNfts = {}
        this.voteParamArray = []

        this.announcedTokenArray = []
        this.announcedContractArray = []
        this.evmAddressArray = []
        this.traceCreateArray = []
        this.adminDestroyTxArray = []
        this.transferredNftArray = []
        this.tokenArray = []
        this.nameTagArray = []
        this.bytes32NameTagArray = []

        this.censorItemArray = []

        this.blockArray = []
        this.transactionArray = []
    }
}

export class BatchData extends ModelData {
    epochArray = []

    addressNfts:any = {}
    addressNftsPlaceholders = []
    addressNftsReplacements = []

    public enqueue(data: ModelData, voteParamArray) {
        this.epochArray.push(data.epoch)
        this.minerBlockArray.push(...data.minerBlockArray)
        this.addrTransferArray.push(...data.addrTransferArray)
        this.epochAddrIdArray.push(...data.epochAddrIdArray)
        this.nftTransferArray.push(...data.nftTransferArray)
        this.addrNftTransferArray.push(...data.addrNftTransferArray)
        this.voteParamArray.push(...voteParamArray)

        this.announcedTokenArray.push(...data.announcedTokenArray)
        this.announcedContractArray.push(...data.announcedContractArray)
        this.evmAddressArray.push(...data.evmAddressArray)
        this.traceCreateArray.push(...data.traceCreateArray)
        this.adminDestroyTxArray.push(...data.adminDestroyTxArray)
        this.transferredNftArray.push(...data.transferredNftArray)
        this.tokenArray.push(...data.tokenArray)
        this.nameTagArray.push(...data.nameTagArray)
        this.bytes32NameTagArray.push(...data.bytes32NameTagArray)

        this.censorItemArray.push(...data.censorItemArray)

        this.addressNftsPlaceholders.push(...data.addressNfts.placeholders)
        this.addressNftsReplacements.push(...data.addressNfts.replacements)
    }

    public data() {
        this.addressNfts = {
            placeholders: this.addressNftsPlaceholders,
            replacements: this.addressNftsReplacements
        }

        this.merge()

        return this
    }

    // merge in asc order by epoch number
    private merge() {
        this.tokenArray = this.mergeItems([...this.announcedTokenArray, ...this.tokenArray])
        this.announcedTokenArray = []

        this.announcedContractArray = this.mergeItems(this.announcedContractArray)

        this.nameTagArray = this.mergeItems([...this.nameTagArray, ...this.bytes32NameTagArray])
        this.bytes32NameTagArray = []
    }

    private mergeItems(items: any[], uniqueKey = 'base32', mergeByField = 'epoch', mergeSort = 'asc') {
        const itemMapping = {}; // base32 => item[]
        items.forEach(item => {
            if(!itemMapping[item[uniqueKey]]) {
                itemMapping[item[uniqueKey]] = []
            }
            itemMapping[item[uniqueKey]].push(item)
        })

        const itemArray = []
        Object.keys(itemMapping).forEach(uniqueKey => {
            const items = lodash.orderBy(itemMapping[uniqueKey], mergeByField, mergeSort)
            const item = lodash.assign(...items)
            itemArray.push(item)
        })

        return itemArray
    }

    public reset() {
        super.reset()

        this.epochArray = []

        this.addressNfts = {}
        this.addressNftsPlaceholders = []
        this.addressNftsReplacements = []
    }
}
