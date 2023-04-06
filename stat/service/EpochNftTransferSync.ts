import {EpochNftTransfer} from "../model/Epoch";
import {SyncBase, SyncCode, SyncData} from "./SyncBase";
import {StatApp} from "../StatApp";
import {fmtDtUTC} from "../model/Utils";
import {CONST} from "./common/constant"
import {Errors} from "./common/LogicError";
import {AddressNftTransfer, NftTransfer} from "../model/NftTransfer";
import {Op, Sequelize} from "sequelize";
import {AddressNfts} from "../model/AddrNft";

export class EpochNftTransferSync extends SyncBase{
    protected app;
    protected debug = false;

    public static SYNC_EPOCH = true;
    public static SYNC_NFT_TRANSFER = true;
    public static SYNC_ADDR_NFT_TRANSFER = true;
    public static SYNC_ADDR_NFT = true;

    constructor(app: StatApp | any) {
        super(app);
        this.app = app;
        this.statSwitch = false;
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
        const {addrNftTransferArray, epoch} = modelData;
        await this.updateAddressNft(epochNumber, epoch.timestamp, addrNftTransferArray, false, dbTx);
    }

    private async deleteAddressNft(epochNumber, modelData, dbTx) {
        const {epoch} = modelData;
        const addrNftTransferArray = await AddressNftTransfer.findAll({where: {epoch: epochNumber}});
        await this.updateAddressNft(epochNumber, epoch.timestamp, addrNftTransferArray, true, dbTx);
    }

    private async updateAddressNft(epochNumber, epochTimestamp, addrNftTransferArray, pivotSwitch, dbTx) {
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

        let index = 0;
        function nextCursor() {
            return Number(`${epochTimestamp.getTime().toString().substring(0, 10)}${(index++).toString().padStart(6, '0')}`);
        }

        for (const k of Object.keys(nftChangeMap)) {
            const key = k.split('_');
            const value = nftChangeMap[k]
            const [addrId, ctId, tokenId] = key;
            const addressId = Number(addrId)
            const contractId = Number(ctId);
            if(addressId === this.app.zeroAddressId) {
                continue;
            }

            const primaryKey = {addressId, contractId, tokenId};
            const updatedCursor = nextCursor();
            if(pivotSwitch) {
                await AddressNfts.update(
                    {'value': Sequelize.literal(`value - ${Number(value)}`), updatedAt: epochTimestamp, updatedCursor},
                    {where: primaryKey, transaction: dbTx}
                );
                await AddressNfts.destroy({where: {...primaryKey, value: {[Op.lt]: 1}}, transaction: dbTx});
            } else{
                const record = await AddressNfts.findOne({where: primaryKey});
                if(!record) {
                    const type = nftTypeMap[contractId];
                    await AddressNfts.create(
                        {...primaryKey, value, type, createdAt: epochTimestamp, updatedAt: epochTimestamp, updatedCursor},
                        {transaction: dbTx}
                    );
                } else{
                    await AddressNfts.update(
                        {'value': Sequelize.literal(`value + ${Number(value)}`), updatedAt: epochTimestamp, updatedCursor},
                        {where: primaryKey, transaction: dbTx}
                    )
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
