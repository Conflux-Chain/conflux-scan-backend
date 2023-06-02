import {sleep} from "./tool/ProcessTool";
import {CONST} from "./common/constant"
import {batchFetchBlock} from "./common/utils";
import {Epoch} from "../model/Epoch";
import {StatApp} from "../StatApp";
import {format} from "js-conflux-sdk";
import {TransferTpsService} from "./TransferTpsService";
import {RedisWrap, TPS_TRANSFER_Q} from "./RedisWrap";
import {StatNotifier} from "./streamstat/StatNotifier";
import {ethers} from "ethers";
import {makeId, makeIdV} from "../model/HexMap";

const lodash = require('lodash');
const TOPIC0_TRANSFER_ERC20 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TOPIC0_TRANSFER_ERC1155_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const TOPIC0_TRANSFER_ERC1155_BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
const TOPIC0_ANNOUNCE = '0x14cb751d0950ff2788201931c45f715f7472443bc197311d9e3a7a0ba566b7e6';
const TOKEN_TRANSFER_TOPICS = [[ TOPIC0_TRANSFER_ERC20, TOPIC0_TRANSFER_ERC1155_SINGLE, TOPIC0_TRANSFER_ERC1155_BATCH,
    TOPIC0_ANNOUNCE ]];

export abstract class SyncBase{
    public static SYNC_BACKWARD = false;

    protected app: StatApp;
    protected statSwitch = false;
    private forwardQueue: PreloadMap;
    private backwardQueue: PreloadMap;

    protected constructor(app: StatApp) {
        this.app = app;
        this.forwardQueue = new PreloadMap(this.getData.bind(this));
        this.backwardQueue = new PreloadMap(this.getData.bind(this));
    }

    private async getDataForwardWithPreload(epochNumber): Promise<SyncData> {
        const {
            app: { cfx, config },
        } = this;

        const stateEpochNumber = await cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE);
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
        const prevEpoch = await this.getEpochByEpochNumber(preEpochNumber);
        const validate = await this.validate(epochNumber, modelData);
        if (prevEpoch && parentHash !== prevEpoch.pivotHash || !validate) {
            return SyncCode.PIVOT_SWITCH;
        }
        await this.save(epochNumber, modelData);
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
        try {
            data = await this.getDataForwardWithPreload(epochNumber);
            if(data.syncCode === SyncCode.RETRY) {
                console.log(`[epoch=${epochNumber}]sync_forward fetch,retry:${data.message}`);
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

        if(syncCode === SyncCode.SUCCESS){
            epochNumber += 1;
        }
        if(syncCode === SyncCode.PIVOT_SWITCH){
            await this.forwardQueue.clear();
            epochNumber -= 1;
            await this.delete(epochNumber, data.modelData).catch((e) => {
                console.log(`[epoch=${epochNumber}]sync_forward del,error`, e);
                throw e;
            });
        }
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

        let stateEpochNumber = await cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE).catch(e => {
            console.log(` SyncBase getEpochNumber error:${e}`);
            return 0;
        });

        async function repeat() {
            if (traceEpochNumber <= stateEpochNumber - (config.preload)) {
                traceEpochNumber = await that.syncForward(traceEpochNumber);
                setTimeout(repeat, 0)
            } else {
                stateEpochNumber = await cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE).catch(e => {
                    console.log(` SyncBase getEpochNumber error:${e}`);
                    return 0;
                });
                setTimeout(repeat, 1000)
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
            cfx.getEpochNumber('latest_state'),
            cfx.getBlocksByEpochNumber(epochNumber)
                .catch(err=>{ console.log(`epoch-sync.getBlocks epoch:${epochNumber} error:${err}`); return [];}),
            cfx.getEpochReceipts(epochNumber)
                .then(res=>{ if (epochNumber === 0) res = []; return res;})
                .catch(err=>{ console.log(`epoch-sync.getReceipts epoch:${epochNumber} error:${err}`); return [];}),
        ]);

        if (latestState < epochNumber) {
            await sleep(1_000);
            throw new Error(`[epoch=${epochNumber}]not ready, latestState=${latestState}`);
        }
        if (blockHashArray.length === 0) {
            throw new Error(`[epoch=${epochNumber}]no block`);
        }
        if (receipts === null) {
            throw new Error(`[epoch=${epochNumber}]not ready, receipts is null`);
        }
        const blockArray = await batchFetchBlock(cfx,  blockHashArray);
        if (epochNumber !== 0 && blockArray.length !== receipts.length && epochNumber !== 0) {
            throw new Error(`[epoch=${epochNumber}]mismatch between blocks and receipts`);
        }

        const transactionHashArray = [];
        for (const [blockIndex, block] of blockArray.entries()) {
            if (epochNumber === 0) {
                break;
            }
            if (block.transactions.length !== receipts[blockIndex].length) {
                throw new Error(`[epoch=${epochNumber}]mismatch between transactions and receipts`);
            }
            for (const [txIndex, tx] of block.transactions.entries()) {
                tx.receipt = receipts[blockIndex][txIndex];
                const receiptStatus = tx.receipt?.outcomeStatus;
                if((receiptStatus === 0 || receiptStatus === 1) &&
                    (tx.receipt.blockHash !== tx.blockHash || tx.receipt.transactionHash !== tx.hash)){
                    throw new Error(`[epoch=${epochNumber}]mismatch between
                    transaction:${JSON.stringify(lodash.pick(tx.receipt, ['blockHash', 'transactionHash']))} and
                    receipt:${JSON.stringify(lodash.pick(tx, ['blockHash', 'hash']))}`);
                }
                transactionHashArray.push(tx.receipt.transactionHash);
            }
        }

        const pivotBlock = blockArray[blockArray.length -1];
        const epoch = {
            epoch: epochNumber,
            pivotHash: pivotBlock.hash.substr(2),
            parentHash: pivotBlock.parentHash.substr(2),
            timestamp: new Date(pivotBlock.timestamp * 1000),
        };

        return {epoch, latestState, blockHashArray, blockArray, transactionHashArray, receipts};
    }

    //------------------------------- event log ------------------------------
    public async getLogsGrouped({epochNumber, epochTimestamp}) {
        const {
            app: { tokenTool },
        } = this;

        const eventLogArray = await this.getLogs({epochNumber, epochTimestamp});
        const groupedLogs = {
            epochNumber,
            transfer20Array: [],
            transfer721Array: [],
            transfer1155Array: [],
            announcementArray: [],
        };

        for(const eventLog of eventLogArray) {
            const [transfer20, transfer721, transfer1155, announcement] = await Promise.all([
                tokenTool.decodeERC20TransferPlus(eventLog),
                tokenTool.decodeERC721Transfer(eventLog),
                tokenTool.decodeERC1155TransferArrayPlus(eventLog),
                tokenTool.decodeAnnouncePlus(eventLog),
            ]);
            if(transfer20) {groupedLogs.transfer20Array.push(transfer20);}
            if(transfer721) {groupedLogs.transfer721Array.push(transfer721);}
            if(transfer1155) {groupedLogs.transfer1155Array.push(transfer1155);}
            if(announcement) {groupedLogs.announcementArray.push(announcement);}
        }
        groupedLogs.transfer1155Array = lodash.flatten(groupedLogs.transfer1155Array);
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
            topics: TOKEN_TRANSFER_TOPICS,
        }).catch(async err=>{
            const msg = `${err}`
            if (msg.includes('expected a numbers with less than largest epoch number.')) {
                const latest = await cfx.getEpochNumber('latest_state');
                console.log(`epoch-sync.eventLogArray epoch:${epochNumber} latestState:${latest} not executed`)
            } else {
                console.log(`epoch-sync.eventLogArray epoch:${epochNumber} error:${msg}`)
            }
            return [];
        });

        if(this.statSwitch) {
            await this.statByEventLog(epochNumber, epochTimestamp, eventLogArray);
        }

        return eventLogArray
            .filter((v) => v.address !== 'CFX:TYPE.CONTRACT:ACAV5V98NP8T3M66UW7X61YER1JA1JM0DPZJ1ZYZXV'
                && v.address !== '0x811dc7fe5B3CFCaB9c84bB3E5e846Dd00ba1561b')
            .map((v) => SyncBase.parseEventLog(v));
    }

    private static parseEventLog(eventLog) {
        eventLog.epochNumber = Number(eventLog.epochNumber);
        eventLog.address = format.hexAddress(eventLog.address);
        eventLog.transactionLogIndex = Number(eventLog.transactionLogIndex);
        return eventLog;
    }

    private async statByEventLog(epochNumber, epochTimestamp, eventLogArray) {
        const eventLogStat = await SyncBase.countEventLog(epochNumber, eventLogArray);

        if(TransferTpsService.TPS_TRANSFER_NOTIFY){
            RedisWrap.sendStreamMessage(lodash.defaults(eventLogStat, {action: 'push'}), TPS_TRANSFER_Q)
                .catch(e => console.log(`epoch-sync.notifyTransferTps epoch:${epochNumber}`, e));
        }

        if(Object.keys(eventLogStat.tokenTransfer).length > 0){
            const msg = {epochNumber, epochTimestamp, action: 'push', tokenTransfer: eventLogStat.tokenTransfer};
            StatNotifier.notifyStatTokenTransfer(msg)
                .catch(e => console.log(`epoch-sync.noticeStatTokenTransfer epoch:${epochNumber}`, e));
            StatNotifier.notifyStatDailyTokenTransfer(msg)
                .catch(e => console.log(`epoch-sync.notifyStatDailyTokenTransfer epoch:${epochNumber}`, e));
        }

        if(Object.keys(eventLogStat.nftMint).length > 0){
            const msg = {epochNumber, epochTimestamp, action: 'push', nftMint: eventLogStat.nftMint};
            StatNotifier.notifyStatNFTMint(msg)
                .catch(e => console.log(`epoch-sync.noticeStatNFTMint epoch:${epochNumber}`, e));
        }
    }

    private static async countEventLog(epochNumber, eventLogArray) {
        let erc20Cntr = 0;
        let erc721Cntr = 0;
        let erc1155Cntr = 0;
        let tokenAddrTransfer = {};
        let tokenTransfer = {};
        let nftAddrMint = {};
        let nftMint = {};

        for (const eventLog of eventLogArray) {
            const topic0 = eventLog.topics[0];
            let incr = 1;
            if(topic0 === TOPIC0_TRANSFER_ERC20 && eventLog.topics.length === 3){
                erc20Cntr++;
            } else if(topic0 === TOPIC0_TRANSFER_ERC20 && eventLog.topics.length === 4){
                erc721Cntr++;
            } else if(topic0 === TOPIC0_TRANSFER_ERC1155_SINGLE){
                erc1155Cntr++;
            } else if(topic0 === TOPIC0_TRANSFER_ERC1155_BATCH){
                const abiCoder = new ethers.utils.AbiCoder()
                const decodedData = abiCoder.decode(["uint256[]","uint256[]"], eventLog.data)
                incr = decodedData[0].length;
                erc1155Cntr += incr;
            } else {
                continue;
            }

            const addr = eventLog.address;
            tokenAddrTransfer[addr] = tokenAddrTransfer[addr] ? (tokenAddrTransfer[addr] + incr) : incr;

            if ((topic0 === TOPIC0_TRANSFER_ERC20 && eventLog.topics.length === 4 &&
                    eventLog.topics[1] === CONST.ZERO_VALUE_IN_SLOT) ||
                ((topic0 === TOPIC0_TRANSFER_ERC1155_SINGLE || topic0 === TOPIC0_TRANSFER_ERC1155_BATCH) &&
                    eventLog.topics[2] === CONST.ZERO_VALUE_IN_SLOT)) {
                nftAddrMint[addr] = nftAddrMint[addr] ? (nftAddrMint[addr] + incr) : incr;
            }
        }

        const addrArray = Object.keys(tokenAddrTransfer);
        for(const addr of addrArray){
            const hex = format.hexAddress(addr);
            const tokenId = (await makeId(hex)).id;
            tokenTransfer[tokenId] = [tokenAddrTransfer[addr]];
            nftAddrMint[addr] && (nftMint[tokenId] = [nftAddrMint[addr]]);
        }

        return {epochNumber, erc20Cntr, erc721Cntr, erc1155Cntr, tokenTransfer, nftMint};
    }

    //---------------------------- token transfer ----------------------------
    public async getTokenTransferArrayDB(epochTimestamp, blockHashArray, {transfer20Array, transfer721Array,
        transfer1155Array}) {
        const {
            ADDRESS_TRANSFER_TYPE: {ERC20, ERC721, ERC1155}
        } = CONST;

        const blockHashMap = {};
        lodash.forEach(blockHashArray, (blockHash, index) => blockHashMap[blockHash] = index);

        let result = [];
        if(transfer20Array.length){
            result = [...result, ...await SyncBase.buildTokenTransferArray(ERC20.code, transfer20Array, epochTimestamp, blockHashMap)];
        }
        if(transfer721Array.length){
            result = [...result, ...await SyncBase.buildTokenTransferArray(ERC721.code, transfer721Array, epochTimestamp, blockHashMap)];
        }
        if(transfer1155Array.length){
            result = [...result, ...await SyncBase.buildTokenTransferArray(ERC1155.code, transfer1155Array, epochTimestamp, blockHashMap)];
        }
        return result;
    }

    public static async buildTokenTransferArray(type, transferArray, epochTimestamp, blockHashMap){
        const addressTransferArray = [];
        for (const item of transferArray) {
            const transfer = {} as any;
            transfer.epoch = item.epochNumber;
            transfer.blockIndex = blockHashMap[item.blockHash];
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
            addressTransferArray.push(lodash.defaults(transfer, {batchIndex: 0, tokenId: 0, value: 1}));
        }
        return addressTransferArray;
    }

    //-------------------- methods subclass to implement ---------------------
    public abstract getData(epochNumber): Promise<SyncData>;

    public abstract save(epochNumber, modelData);

    public abstract delete(epochNumber, modelData);

    public async getNextEpochNumber(){
        let maxEpochNumber:number = await Epoch.max('epoch')
        return maxEpochNumber ? (maxEpochNumber + 1) : 0;
    }

    public async getEpochByEpochNumber(epochNumber){
        return await Epoch.findOne({where:{epoch: epochNumber}});
    }

    public async validate(epochNumber, modelData) {
        const blockArray = modelData.blockArray;
        const revertBlockArray = blockArray.filter(block => block.epochNumber !== epochNumber);
        if(revertBlockArray.length && epochNumber !== 0){ // epochNumber is null in epoch 0 under consortium mode
            console.log(`epoch-sync.validate epoch:${epochNumber}, minerBlockArray:${JSON.stringify(blockArray)}`)
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

export enum SyncCode {
    SUCCESS,
    FAILURE,
    PIVOT_SWITCH,
    RETRY
}
