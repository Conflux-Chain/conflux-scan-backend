import {sleep} from "./tool/ProcessTool";
import {CONST} from "./common/constant"
import {batchFetchBlock} from "./common/utils";
import {Epoch} from "../model/Epoch";
import {makeIdV} from "../model/HexMap";
import {TransactionReceipt} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {FirstBlockNo, RpcCacheOption} from "../config/StatConfig";
import {FullBlock, loadMaxBlockEpoch} from "../model/FullBlock";
import {EpochHashCfxTransfer} from "../CfxTransferSync";
import {cfxSafeEpochReceipts} from "../TokenTransferSync";
import {CfxTransfer} from "../model/CfxTransfer";
import {CONST as SDK_CONST} from "js-conflux-sdk";
const lodash = require('lodash');

const PRELOAD_SIZE_DEFAULT = 16
const PRELOAD_SIZE_CATCHUP = 100

export abstract class SyncBase {
    protected app: any
    protected catchup: Catchup
    private preloadSize: number = PRELOAD_SIZE_DEFAULT
    private forwardQueue: PreloadMap

    protected constructor(app: any) {
        this.app = app;
        this.forwardQueue = new PreloadMap(this.getData.bind(this));
        this.catchup = new Catchup(app)
    }

    private async getDataForwardWithPreload(epochNumber): Promise<SyncData> {
        const stateEpochNumber = await this.latestStateEpoch()
        lodash.range(this.preloadSize).forEach((i) => {
            if (epochNumber + i < stateEpochNumber) {
                this.forwardQueue.start(epochNumber + i);
            }
        });
        return this.forwardQueue.pop(epochNumber);
    }

    private async saveForward(epochNumber, {parentHash, modelData}: SyncData): Promise<SyncCode> {
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
        await this.save(epochNumber, modelData)
        return SyncCode.SUCCESS
    }

    private async syncForward(epochNumber) {
        let syncCode;
        let data: SyncData;

        try {
            data = await this.getDataForwardWithPreload(epochNumber);
            if (data.syncCode === SyncCode.RETRY) {
                console.log(`[epoch=${epochNumber}]sync_forward fetch,retry: ${data.message}`);
                await sleep(10_000);
                return epochNumber;
            }
        } catch (e) {
            console.log(`[epoch=${epochNumber}]sync_forward fetch,error:`, e);
            await sleep(10_000);
            return epochNumber;
        }
        try {
            syncCode = await this.saveForward(epochNumber, data);
        } catch (e) {
            console.log(`[epoch=${epochNumber}]sync_forward sync,error:`, e);
            await sleep(10_000);
            return epochNumber;
        }

        if (syncCode === SyncCode.SUCCESS) {
            epochNumber += 1;
        }
        if (syncCode === SyncCode.PIVOT_SWITCH) {
            this.forwardQueue.clear();
            epochNumber -= 1;
            await this.delete(epochNumber, data.modelData).catch((e) => {
                console.log(`[epoch=${epochNumber}]sync_forward del,error`, e);
                throw e;
            });
        }

        return epochNumber;
    }

    public async run() {
        let epoch = await this.nextEpochNumber()

        if(await this.catchup.status(epoch)) {
            this.preloadSize = PRELOAD_SIZE_CATCHUP
        }

        let latestStateEpoch = await this.latestStateEpoch().catch(e => {
            console.error(`Failed to get latest epoch number`, e)
            return 0
        });

        const that = this
        async function repeat() {
            if (epoch <= latestStateEpoch - (that.preloadSize)) {
                epoch = await that.syncForward(epoch);
                setTimeout(repeat, 0)
            } else {
                latestStateEpoch = await that.latestStateEpoch().catch(e => {
                    console.error(`Failed to get latest epoch number`, e)
                    return 0
                })
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
            this.latestStateEpoch(),
            cfx.getBlocksByEpochNumber(epochNumber),
            cfxSafeEpochReceipts(cfx, epochNumber)
                .then(res => {
                    if (epochNumber === 0) res = [];
                    return res;
                })
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

        const epoch = result.epoch
        if (epoch % 1000 === 0) {
            console.log(`latest state epoch ${epoch} from ${result.table??'rpc'}`)
        }

        return epoch
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

export class Catchup {
    private app: any
    private initialEpoch: number
    private finalizedEpoch: number
    private catchupMode: boolean
    private initialAlready: boolean
    private batchSizeOnSave: number = 100
    private batchData: BatchData

    public constructor(app: any) {
        this.app = app;
        this.batchData = new BatchData()
    }

    private async init(epoch) {
        const {
            app: {cfx},
        } = this

        this.initialEpoch = epoch
        this.finalizedEpoch = await cfx.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_FINALIZED)
        this.catchupMode = this.initialEpoch  < this.finalizedEpoch
    }

    /**
     * @param epoch epoch number to sync
     *
     * @return status
     *      true when in catchup mode
     *      false when catchup already
     */
    public async status(epoch: number): Promise<boolean> {
        const {
            app: {cfx},
        } = this

        if(!this.initialAlready) {
            await this.init(epoch)
            this.initialAlready = true
        }

        if (!this.catchupMode) { // catchup already
            return false
        }

        if (epoch <= this.finalizedEpoch) { // in catchup mode
            return true
        }

        this.finalizedEpoch = await cfx.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_FINALIZED)
        if (epoch <= this.finalizedEpoch) { // compare with latest finalized epoch
            return true
        }

        this.catchupMode = false // in normal mode
        return false
    }

    public add() {

    }

    public clear() {
    }
}

export class BatchData {
    epochs = []
    minerBlocks = []
    tokens = []
    contracts = []
    addressTransfers = []
    epochAddressIds = []
    nftTransfers = []
    addressNftTransfer = []
    evmAddresses = []
    voteParams = []
    traceCreates = []
    adminDestroyTxs = []
    transferNfts = []
    censorItems = []
    addressNftsPlaceholders = []
    addressNftsReplacements = []
    tokenTasks = []
    nameTagTasks = []

    public add(data, tokens, contracts, evmAddresses, voteParams, placeholders, addressNfts, tokenTasks, nameTagTasks) {
        this.epochs.push(data.epoch)
        this.minerBlocks.push(...data.minerBlockArray)
        this.tokens.push(...tokens)
        this.contracts.push(...contracts)
        this.addressTransfers.push(...data.addrTransferArray)
        this.epochAddressIds.push(...data.epochAddrIds)
        this.nftTransfers.push(...data.nftTransferArray)
        this.addressNftTransfer.push(...data.addrNftTransferArray)
        this.evmAddresses.push(...evmAddresses)
        this.voteParams.push(...voteParams)
        this.traceCreates.push(...data.traceCreateArray)
        this.adminDestroyTxs.push(...data.adminDestroyTxArray)
        this.transferNfts.push(...data.transferredNftArray)
        this.censorItems.push(...data.censorItemArray)
        this.addressNftsPlaceholders.push(...placeholders)
        this.addressNftsReplacements.push(...addressNfts)
        this.tokenTasks.push(...tokenTasks)
        this.nameTagTasks.push(...nameTagTasks)
    }

    public clear() {
        this.epochs =[]
        this.minerBlocks =[]
        this.tokens =[]
        this.contracts =[]
        this.addressTransfers =[]
        this.epochAddressIds =[]
        this.nftTransfers =[]
        this.addressNftTransfer =[]
        this.evmAddresses =[]
        this.voteParams =[]
        this.traceCreates =[]
        this.adminDestroyTxs =[]
        this.transferNfts =[]
        this.censorItems =[]
        this.addressNftsPlaceholders =[]
        this.addressNftsReplacements =[]
        this.tokenTasks =[]
        this.nameTagTasks =[]
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
