import {EpochNftTransfer} from "../model/Epoch";
import {SyncBase, SyncCode, SyncData} from "./SyncBase";
import {StatApp} from "../StatApp";
import {fmtDtUTC} from "../model/Utils";
import {makeId, makeIdV} from "../model/HexMap";
import {batchFetchBlock} from "./common/utils";
import {RedisWrap, TPS_TRANSFER_Q} from "./RedisWrap";
import {TransferTpsService} from "./TransferTpsService";
import {StatNotifier} from "./streamstat/StatNotifier";
import {CONST} from "./common/constant"
import {Errors} from "./common/LogicError";
import {sleep} from "./tool/ProcessTool";
import {AddressNftTransfer, NftTransfer} from "../model/NftTransfer";
import {Op} from "sequelize";
import {AddressNfts} from "../model/AddrNft";
const {ethers} = require("ethers");
const { format } = require('js-conflux-sdk');
const lodash = require('lodash');

const TOPIC0_TRANSFER_ERC20 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TOPIC0_TRANSFER_ERC1155_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const TOPIC0_TRANSFER_ERC1155_BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
const TOPIC0_ANNOUNCE = '0x14cb751d0950ff2788201931c45f715f7472443bc197311d9e3a7a0ba566b7e6';
const TOKEN_TRANSFER_TOPICS = [[ TOPIC0_TRANSFER_ERC20, TOPIC0_TRANSFER_ERC1155_SINGLE, TOPIC0_TRANSFER_ERC1155_BATCH,
    TOPIC0_ANNOUNCE ]];

export class EpochNftTransferSync extends SyncBase{
    protected app;
    protected statSwitch = false;
    protected debug = false;

    public static SYNC_EPOCH = true;
    public static SYNC_NFT_TRANSFER = true;
    public static SYNC_ADDR_NFT_TRANSFER = true;
    public static SYNC_ADDR_NFT = true;

    constructor(app: StatApp | any) {
        super(app);
        this.app = app;
    }

    //----------------- implementation method from SyncBase ------------------
    async getData(epochNumber): Promise<SyncData> {
        let epochData;
        try{
            epochData = await this.getEpochData(epochNumber);
        }catch(error) {
            return {syncCode: SyncCode.RETRY, message: `${error}`};
        }
        const {epoch, blockHashArray, blockArray} = epochData;
        const epochTimestamp = epoch.timestamp;

        const eventLogInfo = await this.getLogsGrouped({epochNumber, epochTimestamp});
        const tokenTransferArray = await this.getTokenTransferArrayDB(epochTimestamp, blockHashArray, eventLogInfo);
        const nftTransferArray = await this.getNftTransferArray(epochNumber, tokenTransferArray);
        const addrNftTransferArray = await this.getAddrNftTransferArray(epochNumber,tokenTransferArray);

        return {
            syncCode: SyncCode.SUCCESS,
            parentHash: epoch.parentHash,
            pivotHash: epoch.pivotHash,
            modelData: {epoch, blockArray, nftTransferArray, addrNftTransferArray},
        };
    }

    async validate(epochNumber, modelData) {
        const blockArray = modelData.blockArray;
        const revertBlockArray = blockArray.filter(block => block.epochNumber !== epochNumber);
        if(revertBlockArray.length){
            console.log(`epoch-sync.validate epoch:${epochNumber}, minerBlockArray:${JSON.stringify(blockArray)}`)
            return Promise.resolve(false);
        }

        return Promise.resolve(true);
    }

    async save(epochNumber, modelData) {
        await EpochNftTransfer.sequelize.transaction(async (dbTx) => {
            EpochNftTransferSync.SYNC_EPOCH && await EpochNftTransfer.create(modelData.epoch,
                {transaction: dbTx});
            EpochNftTransferSync.SYNC_ADDR_NFT && await this.saveAddressNft(epochNumber, modelData, dbTx);
            EpochNftTransferSync.SYNC_NFT_TRANSFER && await NftTransfer.bulkCreate(modelData.nftTransferArray,
                {transaction: dbTx});
            EpochNftTransferSync.SYNC_ADDR_NFT_TRANSFER && await AddressNftTransfer.bulkCreate(modelData.addrNftTransferArray,
                {transaction: dbTx});
        });

        if (epochNumber % 100 === 0) {
            console.log(`${fmtDtUTC(new Date())} insert full_epoch at epoch:${epochNumber}`)
        }
        return Promise.resolve();
    }

    async delete(epochNumber, modelData) {
        await EpochNftTransfer.sequelize.transaction(async (dbTx) => {
            const epochDel = await EpochNftTransfer.destroy({where:{epoch: epochNumber}, transaction: dbTx});
            const addrNftDel = await this.deleteAddressNft(epochNumber, modelData, dbTx);
            const nftTransferDel = await NftTransfer.destroy({where: {epoch: epochNumber}, transaction: dbTx});
            const addrNftTransferDel = await AddressNftTransfer.destroy({where: {epoch: epochNumber}, transaction: dbTx});
            console.log(`epoch-sync.delete epoch:${epochNumber}, epochDel:${epochDel}, addrNftDel:${addrNftDel}, 
                nftTransferDel:${nftTransferDel},addrNftTransferDel:${addrNftTransferDel}`);
        });
    }

    public async getNextEpochNumber(){
        let maxEpochNumber:number = await EpochNftTransfer.max('epoch')
        return maxEpochNumber ? (maxEpochNumber + 1) : 0;
    }

    public async getEpochByEpochNumber(epochNumber){
        return await EpochNftTransfer.findOne({where:{epoch: epochNumber}});
    }

    //-------------------------------- epoch ---------------------------------
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
            .map((v) => EpochNftTransferSync.parseEventLog(v));
    }

    private static parseEventLog(eventLog) {
        eventLog.epochNumber = Number(eventLog.epochNumber);
        eventLog.address = format.hexAddress(eventLog.address);
        eventLog.transactionLogIndex = Number(eventLog.transactionLogIndex);
        return eventLog;
    }

    private async statByEventLog(epochNumber, epochTimestamp, eventLogArray) {
        const eventLogStat = await EpochNftTransferSync.countEventLog(epochNumber, eventLogArray);

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
            result = [...result, ...await EpochNftTransferSync.buildTokenTransferArray(ERC20.code, transfer20Array, epochTimestamp, blockHashMap)];
        }
        if(transfer721Array.length){
            result = [...result, ...await EpochNftTransferSync.buildTokenTransferArray(ERC721.code, transfer721Array, epochTimestamp, blockHashMap)];
        }
        if(transfer1155Array.length){
            result = [...result, ...await EpochNftTransferSync.buildTokenTransferArray(ERC1155.code, transfer1155Array, epochTimestamp, blockHashMap)];
        }
        return result;
    }

    private static async buildTokenTransferArray(type, transferArray, epochTimestamp, blockHashMap){
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

    //---------------------------- nft transfer ------------------------------
    public async getNftTransferArray(epochNumber, tokenTransferArray) {
        const {
            ADDRESS_TRANSFER_TYPE: {ERC721, ERC1155}
        } = CONST;

        return tokenTransferArray.filter(t => t.type === ERC721.code|| t.type === ERC1155.code);
    }

    public async getAddrNftTransferArray(epochNumber,tokenTransferArray){
        const {
            ADDRESS_TRANSFER_TYPE: {ERC721, ERC1155}
        } = CONST;

        const result = [];
        tokenTransferArray.filter(t => t.type === ERC721.code|| t.type === ERC1155.code).forEach( transfer => {
            result.push({...transfer, addressId: transfer.fromId})
            const dummyToId = transfer.toId || transfer.contractCreatedId
            if (dummyToId && dummyToId !== transfer.fromId) {
                result.push({...transfer, addressId: dummyToId})
            }
        });

        return result;
    }

    //----------------------------- address nft ------------------------------
    // addressId|epoch|blockIndex|txIndex|txLogIndex|batchIndex|fromId|toId|contractId|tokenId|value|type
    // addressId|contractId|tokenId|value|type
    private async saveAddressNft(epochNumber, modelData, dbTx) {
        const {addrNftTransferArray} = modelData;
        await this.updateAddressNft(epochNumber, addrNftTransferArray, false, dbTx);
    }

    private async deleteAddressNft(epochNumber, modelData, dbTx) {
        const addrNftTransferArray = await AddressNftTransfer.findAll({where: {epoch: epochNumber}});
        await this.updateAddressNft(epochNumber, addrNftTransferArray, true, dbTx);
    }

    private async updateAddressNft(epochNumber, addrNftTransferArray, pivotSwitch, dbTx) {
        if(!addrNftTransferArray?.length) {
            return;
        }

        const nftChangeMap = {};
        const nftTypeMap = {};
        for (const transfer of addrNftTransferArray) {
            const {addressId, fromId, toId, contractId, tokenId, value} = transfer;
            if(fromId === toId){
                continue;
            }

            const key = `${addressId}_${contractId}_${tokenId}`;
            const val = addressId === fromId ? -BigInt(value) : BigInt(value);
            nftChangeMap[key] = !nftChangeMap[key] ? val : nftChangeMap[key] + val;
            nftTypeMap[contractId] = !nftTypeMap[contractId] ? transfer.type : nftTypeMap[contractId];
        }

        for (const k of Object.keys(nftChangeMap)) {
            const key = k.split('_');
            const value = nftChangeMap[k]
            const [addrId, ctId, tokenId] = key;
            const addressId = Number(addrId)
            const contractId = Number(ctId);

            const primaryKey = {addressId, contractId, tokenId};
            if(pivotSwitch) {
                await AddressNfts.increment({'value': -Number(value)}, {where: primaryKey, transaction: dbTx});
                await AddressNfts.destroy({where: {...primaryKey, value: {[Op.lt]: 1}}, transaction: dbTx});
            } else{
                const record = await AddressNfts.findOne({where: primaryKey});
                if(!record) {
                    const type = nftTypeMap[contractId];
                    await AddressNfts.create({...primaryKey, value, type, updatedAt: new Date()}, {transaction: dbTx});
                } else{
                    await AddressNfts.increment({'value': Number(value)}, {where: primaryKey, transaction: dbTx});
                    await AddressNfts.destroy({where: {...primaryKey, value: {[Op.lt]: 1}}, transaction: dbTx});
                }
            }
        }
    }

    //---------------------------- sync backward -----------------------------
    public async getEpochNumberBackward(): Promise<number> {
        throw new Errors.BizError(`not implemented`);
    }

    public async getEpoch(epochNumber) {
        throw new Errors.BizError(`not implemented`);
    }
}


