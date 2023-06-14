import {Epoch} from "../model/Epoch";
import {SyncBase, SyncCode, SyncData} from "./SyncBase";
import {StatApp} from "../StatApp";
import {fmtDtUTC} from "../model/Utils";
import {ESpaceHex40Map, Hex40Map, makeId, makeIdV} from "../model/HexMap";
import {FullMinerBlock} from "../model/FullMinerBlock";
import {Contract} from "../model/Contract";
import {Token} from "../model/Token";
import {Transaction} from "sequelize";
import {batchBlockDetail} from "./common/utils";
import {base64ToPNG, getImageDir, saveOssUrl, uploadOss} from "./tool/TokenTool";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {TraceCreateContract, ContractDestroy} from "../model/TraceCreateContract";
import {PruneNotifier} from "./prune/PruneNotifier";
import {RedisWrap, TPS_TRANSFER_Q} from "./RedisWrap";
import {TransferTpsService} from "./TransferTpsService";
import {ContractVerify} from "../model/ContractVerify";
import {toBase32} from "./tool/AddressTool";
import {CONST} from "./common/constant"
import {AddressTransfer} from "../model/AddrTransfer";
import {PruneType} from "../model/PruneInfo";
import {Errors} from "./common/LogicError";
import {NftMeta} from "./nftchecker/NftMetaStorage";
import {CensorItem} from "../model/CensorItem";
import {CENSOR_TYPE} from "./censor/CensorService";
const { format, sign } = require('js-conflux-sdk');
const lodash = require('lodash');
const zlib = require('zlib');
const abiDecoder = require('abi-decoder');

const FIELDS_TOKEN_BASIC = ['name', 'symbol', 'decimals', 'granularity', 'totalSupply'];
const FIELDS_TOKEN_REGISTER = ['icon', 'website', 'ipfsGateway', 'quoteUrl'];
const FIELDS_TOKEN = [...['hex40id', 'base32'], ...FIELDS_TOKEN_BASIC, ...FIELDS_TOKEN_REGISTER];

const FIELDS_CONTRACT_REGISTER = ['name', 'website', 'abi', 'sourceCode'];
const FIELDS_CONTRACT = [...['hex40id', 'base32'], ...FIELDS_CONTRACT_REGISTER];

const INTERNAL_ADMIN_CONTROL = '0x0888000000000000000000000000000000000000';
const SELECTOR_DESTROY = '0x00f55d9d';
const {abi: ABI_ADMIN_CONTROL} = require("./abi/AdminControl");
const REGEX_CODE_EIP1167 = new RegExp(/^0x363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3$/);

const POCKET_ARRAY = ['gas_payment', 'storage_collateral', 'sponsor_balance_for_gas', 'sponsor_balance_for_collateral',
    'staking_balance', 'balance'];

export class EpochSync extends SyncBase{
    public static SYNC_EPOCH = true;
    public static SYNC_BLOCK = true;
    public static SYNC_ANNOUNCE = true;
    public static SYNC_TRACE = true;
    public static SYNC_TRANSFER = true;
    public static SYNC_DESTROY = true;
    public static SYNC_TOKEN_DETECT = true;
    public static SYNC_TOKEN_AUDIT = true;
    public static SYNC_TOKEN_ICON = true;
    public static SYNC_VERIFY_LINK = true;
    public static SYNC_EVM_ADDR = true;
    public static SYNC_TRANSFERRED_NFT = true;
    public static SYNC_CENSOR_ITEM = true;

    public static erc721Interface = [0x80, 0xac, 0x58, 0xcd];
    public static erc1155Interface = [0xd9, 0xb6, 0x7a, 0x26];

    protected app;
    private NAME_TYPE_MAP;

    constructor(app: StatApp | any) {
        super(app);
        this.app = app;
        this.NAME_TYPE_MAP = lodash.keyBy(Object.values(CONST.ADDRESS_TRANSFER_TYPE), 'name');
        this.statSwitch = true;
    }

    //----------------- implementation method from SyncBase -----------------
    async getData(epochNumber): Promise<SyncData> {
        try{
            const epochData = await this.getEpochData(epochNumber);
            const {epoch, blockHashArray, blockArray, transactionHashArray} = epochData;
            const epochTimestamp = epoch.timestamp;

            const minerBlockArray = await this.getMinerBlockArray(blockArray);
            const adminDestroyTxArray = await this.getAdminDestroyTxArray(blockArray, epochTimestamp);

            const eventLogInfo = await this.getLogsGrouped({epochNumber, epochTimestamp});
            const announceInfo = await this.getAnnounceInfo(epochNumber, eventLogInfo.announcementArray);
            const tokenArray = await this.getTokensAutoDetected(eventLogInfo);

            const traceArray = await this.getTraceArray(epochNumber);
            const createArray = await this.getTraceCreateArrayPlus(traceArray);
            const traceCreateArray = await this.getTraceCreateArrayDBPlus(createArray);
            const crossSpaceArray = await this.getTraceCrossSpaceArray(traceArray);
            const traceCrossSpaceArray = await this.getTraceCrossSpaceArrayDB(crossSpaceArray);

            const tokenTransferArray = await this.getTokenTransferArrayDB(epochTimestamp, blockHashArray, eventLogInfo);
            const cfxTransferArray = await this.getCFXTransferArrayDB(epochTimestamp, blockHashArray, traceArray);
            const txArray = await EpochSync.getAddrTxArray(blockArray, epochTimestamp);
            const addrTransferArray = await this.getAddrTransferArrayDB(epochNumber, tokenTransferArray, cfxTransferArray,
                txArray);
            const transferredNftArray = this.getTransferredNftArray(epochNumber, addrTransferArray);
            const censorItemArray = this.getCensorItemArray(epoch, transactionHashArray);

            PruneNotifier.notifyBlock(minerBlockArray)
                .catch(e => console.log(`epoch-sync.noticePruneBlock, epoch:${epochNumber}`, e));
            const addrIds = [...new Set(lodash.map(addrTransferArray, item => item.addressId))];
            PruneNotifier.notifyPrune({[PruneType.ADDR_TRANSFER]: addrIds})
                .catch(e => console.log(`epoch-sync.noticePruneAddrTransfer, epoch:${epochNumber}`, e));

            return {
                syncCode: SyncCode.SUCCESS,
                parentHash: epoch.parentHash,
                pivotHash: epoch.pivotHash,
                modelData: {epoch, blockArray, minerBlockArray, announceInfo, tokenArray, traceCreateArray,
                    traceCrossSpaceArray, adminDestroyTxArray, addrTransferArray, transferredNftArray, censorItemArray},
            };
        }catch(error) {
            return {syncCode: SyncCode.RETRY, message: `${error}`};
        }

    }

    async save(epochNumber, modelData) {
        const { tokenQuery } = this.app;
        await Epoch.sequelize.transaction(async (dbTx) => {
            EpochSync.SYNC_EPOCH && await Epoch.create(modelData.epoch, {transaction: dbTx});
            EpochSync.SYNC_BLOCK && await FullMinerBlock.bulkCreate(modelData.minerBlockArray, {transaction: dbTx});
            EpochSync.SYNC_ANNOUNCE && await EpochSync.saveAnnounceInfo(epochNumber, modelData.announceInfo, dbTx);
            EpochSync.SYNC_TRACE && await TraceCreateContract.bulkCreate(modelData.traceCreateArray, {
                updateOnDuplicate:["epochNumber","blockTime","txHash","traceIndex"],
                transaction: dbTx
            });
            EpochSync.SYNC_TRANSFER && await AddressTransfer.bulkCreate(modelData.addrTransferArray, {transaction: dbTx});
            EpochSync.SYNC_DESTROY && await ContractDestroy.bulkCreate(modelData.adminDestroyTxArray, {
                updateOnDuplicate:["epochNumber","blockTime","txHash","admin"],
                transaction: dbTx,
            });
            EpochSync.SYNC_TRANSFERRED_NFT && await NftMeta.bulkCreate(modelData.transferredNftArray, {
                updateOnDuplicate:["epochNumber"],
                transaction: dbTx,
            });
            EpochSync.SYNC_CENSOR_ITEM && await CensorItem.bulkCreate(modelData.censorItemArray, {
                updateOnDuplicate:["epochNumber", "censorType", "censorStatus", "createdAt", "updatedAt"],
                transaction: dbTx,
            });
        });

        const tokenArray = modelData.tokenArray;
        for(const token of tokenArray){
            if(!EpochSync.SYNC_TOKEN_DETECT) break;
            await Token.upsert(token);
        }

        const addressArray = [
            ...modelData.announceInfo.tokenArray.map(item => item.base32),
            ...modelData.tokenArray.map(item => item.base32)
        ];
        for(const address of addressArray){
            if(!EpochSync.SYNC_TOKEN_AUDIT) break;
            await tokenQuery.audit({address});
        }

        try{
            const {tokenArray} = modelData.announceInfo;
            const {dir} = getImageDir();
            for (const token of tokenArray) {
                if(!EpochSync.SYNC_TOKEN_ICON) break;
                if (token.icon) {
                    const dbIcon = await Token.findOne({where: {base32: token.base32}});
                    setTimeout(()=>{
                        base64ToPNG(dbIcon, dir).then(({absPath, filename})=>{
                            return uploadOss(absPath, filename)
                        }).then(res=>{
                            return saveOssUrl(dbIcon, res)
                        }).catch(err=>{
                            console.log(`epoch-sync.create one TokenIcon url fail: ${token.base32}`, err);
                        })
                    }, 10_000)
                }
            }
        } catch (e){
            console.log(`epoch-sync, createTokenIcon url fail`, e);
        }

        const traceCreateArray = modelData.traceCreateArray;
        for(const traceCreate of traceCreateArray){
            if(!EpochSync.SYNC_VERIFY_LINK) break;
            const hex40 = await Hex40Map.findOne({where: {id: traceCreate.to}});
            const address = `0x${hex40.hex}`;
            const codeHash = traceCreate.codeHash;
            const isEIP1167 = await this.verifyMinimalProxy({address}).catch(e => {
                console.log(`[${address}]epoch-sync.minimalVerify`, e);
                return false;
            });
            if(isEIP1167) continue;
            await this.linkVerify({address, codeHash});
        }

        const traceCrossSpaceArray = modelData.traceCrossSpaceArray;
        for(const traceCrossSpace of traceCrossSpaceArray){
            if(!EpochSync.SYNC_EVM_ADDR) break;
            if(traceCrossSpace.fromSpace === 'evm'){
                await ESpaceHex40Map.create({hexId: traceCrossSpace.from, hex: traceCrossSpace.fromHex.substr(2)});
            }
            if(traceCrossSpace.toSpace === 'evm'){
                await ESpaceHex40Map.create({hexId: traceCrossSpace.to, hex: traceCrossSpace.toHex.substr(2)});
            }
        }

        if (epochNumber % 100 === 0) {
            console.log(`${fmtDtUTC(new Date())} insert full_epoch at epoch:${epochNumber}`)
        }
        return Promise.resolve();
    }

    async delete(epochNumber, modelData) {
        await Epoch.sequelize.transaction(async (dbTx) => {
            const epochDel = await Epoch.destroy({where:{epoch: epochNumber}, transaction: dbTx});
            const minerBlockDel = await FullMinerBlock.destroy({where: {epoch: epochNumber}, transaction: dbTx});
            const traceCreateDel = await TraceCreateContract.destroy({where: {epochNumber}});
            const addrTransferDel = await AddressTransfer.destroy({where: {epoch: epochNumber}, transaction: dbTx});
            const contractDestroyDel = await ContractDestroy.destroy({where: {epochNumber}});
            const censorItemDel = await CensorItem.destroy({where: {epochNumber}, transaction: dbTx});
            console.log(`epoch-sync.delete epoch:${epochNumber}, epochDel:${epochDel}, minerBlockDel:${minerBlockDel},
                traceCreateDel:${traceCreateDel},addrTransferDel:${addrTransferDel},contractDestroyDel:${contractDestroyDel},
                censorItemDel:${censorItemDel}`);
        });

        if(TransferTpsService.TPS_TRANSFER_NOTIFY) {
            RedisWrap.sendStreamMessage({epochNumber, action: 'pop'}, TPS_TRANSFER_Q).then().catch(
                err => console.log(`epoch-sync.transfer-tps-pop epoch:${epochNumber} error:${err}`)
            );
        }
    }

    //------------------- business method for miner block --------------------
    public async getMinerBlockArray(blockArray) {
        let minerBlockArray = await Promise.all(blockArray.map(async (block: any, position) => {
            const hex40 = format.hexAddress(block.miner);
            const blockDt = new Date(block.timestamp * 1000);
            const hex40Id = (await makeId(hex40, undefined, {dt: blockDt})).id;
            return {minerId: hex40Id, epoch: block.epochNumber, position, createdAt: blockDt};
        }));
        return lodash.orderBy(minerBlockArray, 'position', 'desc');
    }

    //---------------- business method for admin destroy tx ------------------
    private async getAdminDestroyTxArray(blockArray, blockTime){
        const adminDestroyTxArray = [];
        for(const block of blockArray){
            const {epochNumber, transactions} = block;
            if(!transactions?.length) {
                continue;
            }

            for (const transaction of transactions){
                const {hash, from, to, data, status} = transaction;
                if(status !== 0 || to === null) {
                    continue;
                }

                const toHex = format.hexAddress(to);
                if(toHex === INTERNAL_ADMIN_CONTROL && data.substr(0, 10) === SELECTOR_DESTROY){
                    const fromHex = format.hexAddress(from);
                    const decodedData = this.decodeData(ABI_ADMIN_CONTROL, data);
                    const contract = decodedData.params[0].value;
                    const destroyTx = {epochNumber, blockTime, txHash: hash.substr(2), admin: fromHex.substr(2),
                        contract: contract.substr(2)};
                    adminDestroyTxArray.push(destroyTx);
                }
            }
        }

        return adminDestroyTxArray;
    }

    public decodeData(abi, data){
        console.log(`abi------${typeof abi}`)
        let decodedData;
        try{
            abiDecoder.addABI(abi);
            decodedData = abiDecoder.decodeMethod(data);
        } finally {
            abiDecoder.removeABI(abi);
        }

        return decodedData;
    }

    //--------------------- business method for announce ---------------------
    private static async saveAnnounceInfo(epochNumber, {tokenArray, contractArray}, dbTx: Transaction = undefined) {
        for (const token of tokenArray) {
            let t = lodash.defaults({updatedAt: new Date()}, lodash.pick(token, FIELDS_TOKEN));
            await Token.upsert(t, { transaction:dbTx });
        }
        for (const contract of contractArray) {
            let c = lodash.defaults({epoch: epochNumber, updatedAt: new Date()}, lodash.pick(contract, FIELDS_CONTRACT));
            await Contract.upsert(c, { transaction:dbTx });
        }
    }

    private async getAnnounceInfo(epochNumber, announceArray) {
        const {
            app: { tokenTool },
        } = this;

        let tokenMap = {};
        let contractMap = {};
        for(const announce of announceArray) {
            const key = Buffer.from(announce.key, 'base64').toString();
            const params = key.split('/');
            if(params[0] === 'token') {
                EpochSync.parseAnnounce(epochNumber, params, announce, tokenMap);
            }
            if(params[0] === 'contract') {
                EpochSync.parseAnnounce(epochNumber, params, announce, contractMap);
            }
        }

        const tokenArray = [];
        const tokenHexArray = Object.keys(tokenMap);
        for(const hex of tokenHexArray){
            let token = tokenMap[hex];
            token.hex40id = (await makeId(hex)).id;
            token.base32 = format.address(hex, StatApp.networkId);
            const totalSupply = await tokenTool.getTokenTotalSupply(token.base32);
            const tokenInfo = await tokenTool.getToken(token.base32);
            token = lodash.defaults(token, { totalSupply, name: tokenInfo.name, symbol: tokenInfo.symbol,
                decimals: tokenInfo.decimals, granularity: tokenInfo.granularity });
            tokenArray.push(token);
        }
        const contractArray = [];
        const contractHexArray = Object.keys(contractMap);
        for(const hex of contractHexArray){
            let contract = contractMap[hex];
            contract.hex40id = (await makeId(hex)).id;
            contract.base32 = format.address(hex, StatApp.networkId);
            contractArray.push(contract);
        }

        return {tokenArray, contractArray};
    }

    private static parseAnnounce(epochNumber, params, announce, map){
        if(params[1] === 'list'){
            const [ , , hex] = params;
            map[hex] = map[hex] || {};
            console.log(`announce---epoch:${epochNumber}---${params}`);
        } else{
            const [ , hex, field] = params;
            if (!/0x[0-9a-fA-F]{40}/.test(hex)) {
                console.log(`announce---epoch:${epochNumber}---${params}`);
                return map;
            }

            const isBlob = (field === 'abi' || field === 'sourceCode' || field === 'icon');
            const item = map[hex] || {};
            item[field] = isBlob ? Buffer.from(zlib.unzipSync(Buffer.from(announce.value, "base64"))).toString()
                : Buffer.from(announce.value, 'base64').toString();

            if (field === 'name' && item[field].length >= 255) {
                item[field] = item[field].substr(0, 255);
            }
            console.log(`announce---epoch:${epochNumber}---${params}---${isBlob ? (item[field])?.length : item[field]}`);

            map[hex] = item;
        }
        return map;
    }

    // ----------------------- business method for token ------------------------
    private async getTokensAutoDetected({ transfer20Array, transfer721Array, transfer1155Array }) {
        let tokenArray = [];
        try{
            const [crc20AddressArray, crc721AddressArray, crc1155AddressArray]  = await Promise.all([
                [... new Set(transfer20Array.map(item => item.address).filter(Boolean))],
                [... new Set(transfer721Array.map(item => item.address).filter(Boolean))],
                [... new Set(transfer1155Array.map(item => item.address).filter(Boolean))]
            ]);
            if(crc20AddressArray.length){
                tokenArray = [...tokenArray, ...await this.getTokens(crc20AddressArray, CONST.TRANSFER_TYPE.ERC20)];
            }
            if(crc721AddressArray.length){
                tokenArray = [...tokenArray, ...await this.getTokens(crc721AddressArray, CONST.TRANSFER_TYPE.ERC721)];
            }
            if(crc1155AddressArray.length){
                tokenArray = [...tokenArray, ...await this.getTokens(crc1155AddressArray, CONST.TRANSFER_TYPE.ERC1155)];
            }
        }catch (e){
            console.log(`epoch-sync.getTokensAutoDetected fail`, e);
            throw e;
        }
        return tokenArray;
    }

    private async getTokens(hexAddressArray, transferType){
        const tokenArray = [];
        for(const hex40 of hexAddressArray){
            const token = await this.getToken(hex40, transferType);
            token && tokenArray.push(token);
        }
        return tokenArray;
    }

    private async getToken(hexAddress, transferType){
        const {
            app: { tokenTool },
        } = this;

        const hex40id = (await makeId(hexAddress)).id;
        const tokenDb = await Token.findOne({where: {hex40id}, raw: true});
        if(tokenDb && tokenDb.type){
            return undefined;
        }

        const base32 = format.address(hexAddress, StatApp.networkId);
        const [ totalSupply, tokenInfo, erc721Interface, erc1155Interface ] = await Promise.all([
            tokenTool.getTokenTotalSupply(base32),
            tokenTool.getToken(base32),
            tokenTool.supportsInterface(base32, EpochSync.erc721Interface),
            tokenTool.supportsInterface(base32, EpochSync.erc1155Interface),
        ]);
        if((transferType === CONST.TRANSFER_TYPE.ERC721 && erc721Interface === false) ||
            (transferType === CONST.TRANSFER_TYPE.ERC1155 && erc1155Interface === false)){
            return undefined;
        }

        let token = lodash.defaults({}, { hex40id, base32, name: tokenInfo.name, symbol: tokenInfo.symbol,
            decimals: tokenInfo.decimals, granularity: tokenInfo.granularity, totalSupply,
            type: transferType});
        const transferCount = (await EpochSync.countTransfer(hex40id, transferType)) || 1;
        const auditResult = (token?.name?.trim()?.length > 0) && (token?.symbol?.trim()?.length > 0);
        token = lodash.defaults(token, {transfer: transferCount, auditResult, fetchBalance: auditResult });
        return token;
    }

    private static async countTransfer(addressId, transferType) {
        if(transferType === CONST.TRANSFER_TYPE.ERC20)
            return Erc20Transfer.count({ where: { contractId: addressId }});
        if(transferType === CONST.TRANSFER_TYPE.ERC721)
            return Erc721Transfer.count({ where: { contractId: addressId }});
        if(transferType === CONST.TRANSFER_TYPE.ERC1155)
            return Erc1155Transfer.count({ where: { contractId: addressId }});
    }

    // ---------------------------- address transfer ----------------------------
    public async getAddrTransferArrayDB(epochNumber,tokenTransferArray,cfxTransferArray,txArray){
        const result = [];
        [...tokenTransferArray, ...cfxTransferArray, ...txArray].forEach( transfer => {
            result.push({...transfer, addressId: transfer.fromId})

            const dummyToId = transfer.toId || transfer.contractCreatedId
            if (dummyToId && dummyToId !== transfer.fromId) {
                result.push({...transfer, addressId: dummyToId})
            }
        });
        return result;
    }

    private static async getAddrTxArray(blockArray, epochTimestamp){
        const addrTxArray = [];
        for(const [blockIndex, block] of blockArray.entries()){
            if(!block.transactions?.length) {
                continue;
            }

            for (const [txIndex, item] of block.transactions.entries()){
                const receiptStatus = item.receipt?.outcomeStatus;
                if (receiptStatus != 0 && receiptStatus != 1 && block.epochNumber !== 0) {
                    continue;
                }

                const tx = {} as any;
                tx.epoch = block.epochNumber;
                tx.blockIndex = blockIndex;
                tx.txIndex = txIndex;

                const [fromId, toId, contractCreatedId] = await Promise.all([
                    makeIdV(item.from, undefined, {dt: epochTimestamp}),
                    makeIdV(item.to, undefined, {dt: epochTimestamp}),
                    makeIdV(item.contractCreated, undefined, {dt: epochTimestamp}),
                ]);
                tx.fromId = fromId;
                tx.toId = toId;
                tx.value = item.value.toString();
                tx.contractCreatedId = contractCreatedId;

                tx.type = CONST.ADDRESS_TRANSFER_TYPE.TX.code;
                tx.createdAt = epochTimestamp;
                addrTxArray.push(lodash.defaults(tx, {txLogIndex: 0, batchIndex: 0, contractId: 0, tokenId: 0}));
            }
        }
        return addrTxArray;
    }

    private async getCFXTransferArrayDB(epochTimestamp, blockHashArray, traceArray) {
        const blockHashMap = {};
        lodash.forEach(blockHashArray, (blockHash, index) => blockHashMap[blockHash] = index);

        const result = [];
        for (const trace of traceArray) {
            if (trace.valid && trace.action.value &&
                (
                    trace.type === CONST.TRACE_TYPE.CREATE ||
                    (trace.type === CONST.TRACE_TYPE.CALL && trace.action.callType === 'call') ||
                    (trace.type === CONST.TRACE_TYPE.INTERNAL_TRANSFER_ACTION && (
                        (trace.action.fromPocket === 'balance' && lodash.includes(POCKET_ARRAY, trace.action.toPocket))||
                        (trace.action.toPocket === 'balance' && lodash.includes(POCKET_ARRAY, trace.action.fromPocket))
                    ))
                )
            ) {

                const transfer = {} as any;
                transfer.epoch = trace.epochNumber;
                transfer.blockIndex = blockHashMap[trace.blockHash];
                transfer.txIndex = trace.transactionIndex;
                transfer.txLogIndex = trace.transactionTraceIndex;

                const [fromId, toId] = await Promise.all([
                    makeIdV(trace.action.from, undefined, {dt: epochTimestamp}),
                    makeIdV(trace.action.to, undefined, {dt: epochTimestamp}),
                ]);
                transfer.fromId = fromId;
                transfer.toId = toId;
                transfer.value = trace.action.value.toString();

                transfer.type = this.getCFXTransferType(trace.type, trace.action.fromPocket, trace.action.toPocket);
                transfer.createdAt = epochTimestamp;
                result.push(lodash.defaults(transfer, {batchIndex: 0, contractId: 0, tokenId: 0}));
            }
        }
        return result;
    }

    private getCFXTransferType(type, fromPocket, toPocket) {
        const typeName = (type === CONST.TRACE_TYPE.CALL || type === CONST.TRACE_TYPE.CREATE) ? type :
            (fromPocket !== 'balance' ? fromPocket : toPocket);

        return this.NAME_TYPE_MAP[typeName].code;
    }

    // ----------------------------- nft transfer -------------------------------
    public getTransferredNftArray(epochNumber, addrTransferArray) {
        const {
            ADDRESS_TRANSFER_TYPE: {ERC721, ERC1155}
        } = CONST;

        const nftInfo = {};
        addrTransferArray.filter(t => t.type === ERC721.code|| t.type === ERC1155.code).forEach(t => {
            let set = nftInfo[t['contractId']];
            if(!set) {
                set = new Set();
                nftInfo[t['contractId']] = set;
            }
            set.add(t['tokenId']);
        });

        const nftArray = [];
        Object.keys(nftInfo).forEach(contractId => {
            const tokenIdSet = nftInfo[contractId];
            tokenIdSet.forEach(tokenId => nftArray.push({epochNumber, contractId: Number(contractId), tokenId}));
        });

        return nftArray;
    }

    // ------------------------------ trace create ------------------------------
    public async getTraceCrossSpaceArray(traceArray) {
        // filter
        const crossSpaceTraceArray = [];
        traceArray.forEach((trace) => {
            if (trace.status === CONST.TX_STATUS.SUCCESS
                && (trace.action.fromSpace === 'evm' || trace.action.toSpace === 'evm' )) {
                crossSpaceTraceArray.push({
                    epochNumber: trace.epochNumber,
                    blockTime: trace.blockTime,
                    transactionHash: trace.transactionHash,
                    transactionTraceIndex: trace.transactionTraceIndex,
                    type: trace.type,
                    from: trace.action.from,
                    to: trace.action.to,
                    fromSpace: trace.action.fromSpace,
                    toSpace: trace.action.toSpace,
                    value: trace.action.value,
                    valid: trace.valid,
                });
            }
        });
        return crossSpaceTraceArray;
    }

    public async getTraceCrossSpaceArrayDB(crossSpaceTraceArray) {
        const blockDt = crossSpaceTraceArray.length > 0 ? new Date(crossSpaceTraceArray[0].blockTime*1000) : undefined;

        const traceCrossSpaceArrayDB = []
        for (const trace of crossSpaceTraceArray) {
            if(!trace?.valid) continue;
            const txHash = trace.transactionHash.substr(2);
            const from = (await makeId(trace.from, undefined, {dt:blockDt})).id;
            const to = (await makeId(trace.to, undefined, {dt:blockDt})).id;
            const fromHex = format.hexAddress(trace.from);
            const toHex = format.hexAddress(trace.to);
            const toCreate = {
                epochNumber: trace.epochNumber,
                txHash,
                traceIndex: trace.transactionTraceIndex,
                from,
                to,
                fromHex,
                toHex,
                fromSpace: trace.fromSpace,
                toSpace: trace.toSpace,
                value: trace.value,
                outcome: trace.outcome,
                blockTime: trace.blockTime,
            };
            traceCrossSpaceArrayDB.push(toCreate)
        }
        return traceCrossSpaceArrayDB;
    }

    public async getTraceCreateArrayPlus(traceArray) {
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
                    valid: trace.valid,
                    init: trace.action.init,
                });
            }
        });
        return createTraceArray;
    }

    public async getTraceCreateArrayDBPlus(traceCreateArray) {
        const blockDt = traceCreateArray.length > 0 ? new Date(traceCreateArray[0].blockTime*1000) : undefined;

        const traceCreateArrayDB = []
        for (const trace of traceCreateArray) {
            if(!trace?.valid) continue;
            const txHashId = 0; // (await makeId(trace.transactionHash)).id;
            const txHash = trace.transactionHash.substr(2);
            const from = (await makeId(trace.from, undefined, {dt:blockDt})).id;
            const to = (await makeId(trace.to, undefined, {dt:blockDt})).id;
            const codeHash = await this.getCodeHash(trace.to);
            const toCreate = {
                epochNumber: trace.epochNumber,
                txHashId,
                txHash,
                traceIndex: trace.transactionTraceIndex,
                from,
                to,
                value: trace.value,
                outcome: trace.outcome,
                blockTime: trace.blockTime,
                codeHash,
            };
            traceCreateArrayDB.push(toCreate)
        }
        return traceCreateArrayDB;
    }

    public async getTraceCreateArrayDB(epochNumber) {
        const traceCreateArray = await this.getTraceCreateArray(epochNumber);
        const blockDt = traceCreateArray.length > 0 ? new Date(traceCreateArray[0].blockTime*1000) : undefined;

        const traceCreateArrayDB = []
        for (const trace of traceCreateArray) {
            if(!trace?.valid) continue;
            const txHashId =  (await makeId(trace.transactionHash)).id;
            const from = (await makeId(trace.from, undefined, {dt:blockDt})).id;
            const to = (await makeId(trace.to, undefined, {dt:blockDt})).id;
            const codeHash = await this.getCodeHash(trace.to);
            const toCreate = {
                epochNumber: trace.epochNumber,
                txHashId,
                traceIndex: trace.transactionTraceIndex,
                from,
                to,
                value: trace.value,
                outcome: trace.outcome,
                blockTime: trace.blockTime,
                codeHash,
            };
            traceCreateArrayDB.push(toCreate)
        }
        return traceCreateArrayDB;
    }

    public async getTraceCreateArray(epochNumber, detail = false) {
        const traceArray = await this.getTraceArray(epochNumber, detail);
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
                    valid: trace.valid,
                    init: trace.action.init,
                });
            }
        });
        return createTraceArray;
    }

    public async getTraceArray(epochNumber, detail = false) {
        let traceArray = [];
        const [blockArray, traceArray2d] = await this.getBlockArray(epochNumber);
        blockArray.forEach((block, idx) => {
            if (!block.transactions.length) {
                return;
            }

            const blockTrace:any = traceArray2d[idx]
            if (!blockTrace) {
                // no trace at block
                return traceArray;
            }

            // assemble traces
            // @ts-ignore
            lodash.zip(block.transactions, blockTrace.transactionTraces)
                .forEach(([transaction, transactionTracesItem], transactionIndex) => {
                    const transactionTraceArray = [];
                    transactionTracesItem?.traces?.forEach((trace, transactionTraceIndex) => {
                        transactionTraceArray.push({
                            epochNumber: block.epochNumber,
                            blockHash: block.hash,
                            blockTime: block.timestamp,
                            transactionHash: transaction.hash,
                            transactionIndex,
                            transactionTraceIndex,
                            status: transaction.status,
                            ...EpochSync.parseTrace(trace, detail),
                        });
                    });
                    traceArray = [...traceArray, ...EpochSync.matchTrace(transactionTraceArray, transaction)];
                });
        });
        return traceArray;
    }

    private async getBlockArray(epochNumber) : Promise<any[]> {
        const {
            app: { cfx },
        } = this;

        const blockHashArray = await cfx.getBlocksByEpochNumber(epochNumber);
        const [blockArray, traceArray] = await batchBlockDetail(cfx, blockHashArray);
        blockArray.map((v) => EpochSync.parseBlock(v, true));
        return [blockArray, traceArray];
    }

    private static parseBlock(block, detail = false) {
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

    private static parseTrace(trace, detail = false) {
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
            if(!detail){
                trace.action.init = '';
            }
        }
        return trace;
    }

    public static matchTrace(transactionTraceArray, transaction){
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

    private async getCodeHash(address){
        const {
            app: { cfx },
        } = this;

        const code = await cfx.getCode(address);
        return sign.keccak256(Buffer.from(code)).toString('hex');
    }

    // ---------------------------- contract verify -----------------------------
    public async linkVerify({address, codeHash}){
        const {
            app: { contractQuery },
        } = this;

        const matchVerify = await ContractVerify.findOne({
            where: {codeHash, verifyResult: true},
            order: [['updatedAt', 'ASC']],
            raw: true
        });
        if(!matchVerify) {
            return;
        }

        const base32 = toBase32(address);
        const similarMatch = matchVerify.base32;
        const createdAt = new Date();

        const bytecode = await contractQuery.exactBytecode({address: matchVerify.base32,
            constructorArgs: matchVerify.constructorArgs});
        const constructorArgs = await contractQuery.exactConstructorArgs({address: base32, bytecode});

        const matchRecord = lodash.assign(matchVerify, CONST.MATCH_STATUS.SIMILAR,
            {id: undefined, implementation: undefined, base32, constructorArgs, similarMatch, createdAt,
                updatedAt: createdAt});
        await ContractVerify.create(matchRecord).catch(() => undefined);
    }

    public async verifyMinimalProxy({address}): Promise<boolean> {
        const {
            app: { cfx },
        } = this;

        let isEIP1167 = false;
        const code = await cfx.getCode(address);
        if(!REGEX_CODE_EIP1167.test(code)) {
            return isEIP1167;
        }

        isEIP1167 = true;
        const implementation = toBase32(`0x${code.substr(22, 40)}`);
        const implVerify = await ContractVerify.findOne({where: {base32: implementation, verifyResult: true},
            order: [['updatedAt', 'ASC']], raw: true});
        const now = new Date();
        const base32 = toBase32(address);
        const proxyPattern = 'Minimal Proxy Contract';
        const codeHash = sign.keccak256(Buffer.from(code)).toString('hex');
        const verify = {base32, proxy: true, implementation, proxyPattern, codeHash, createdAt: now, updatedAt: now};

        let proxyVerify;
        if(!implVerify) {
            proxyVerify = lodash.assign(verify, {name: '__MinimalProxy__'});
        } else{
            proxyVerify = lodash.assign(implVerify, verify, {id: undefined, similarMatch: undefined, guid: undefined});
        }
        await ContractVerify.create(proxyVerify).catch(() => undefined);

        return isEIP1167;
    }

    // ------------------------------ text censor -------------------------------
    public getCensorItemArray(epoch, transactionHashArray) {
        const {epoch: epochNumber, timestamp: createdAt} = epoch;

        const items = [];
        transactionHashArray.forEach(transactionHash => items.push({transactionHash, censorType: CENSOR_TYPE.TX}));
        items.forEach(item => lodash.assign(item, {epochNumber, createdAt, updatedAt: createdAt}));

        return items;
    }

    // ----------------------------- sync backward ------------------------------
    public async getEpochNumberBackward(): Promise<number> {
        if (EpochSync.SYNC_TRANSFER) {
            const minEpoch: number = await AddressTransfer.min('epoch');
            return (minEpoch || 0) - 1;
        }
        throw new Errors.BizError(`not implemented`);
    }

    public async getEpoch(epochNumber) {
        const {
            app: { cfx },
        } = this;

        const pivotBlock = await cfx.getBlockByEpochNumber(epochNumber, false).catch(async err=>{
            const msg = `${err}`
            if (msg.includes('expected a numbers with less than largest epoch number.')) {
                const latest = await cfx.getEpochNumber('latest_state');
                console.log(`epoch-sync.pivotBlock epoch:${epochNumber} latestState:${latest} not executed`)
            } else {
                console.log(`epoch-sync.pivotBlock epoch:${epochNumber} error:${msg}`)
            }
            throw err;
        });
        pivotBlock.timestamp = Number(pivotBlock.timestamp);
        const now = Math.floor(Date.now() / 1000);
        const timestamp = lodash.min([pivotBlock.timestamp, now]);// XXX: for filter negative timestamp

        return {
            epoch: epochNumber,
            pivotHash: pivotBlock.hash.substr(2),
            parentHash: pivotBlock.parentHash.substr(2),
            timestamp: new Date(timestamp * 1000),
        };
    }
}
