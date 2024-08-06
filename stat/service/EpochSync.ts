import {Epoch, VoteParams} from "../model/Epoch";
import {SyncBase, SyncCode, SyncData} from "./SyncBase";
import {StatApp} from "../StatApp";
import {fmtDtUTC} from "../model/Utils";
import {ESpaceHex40Map, Hex40Map, makeId, makeIdV} from "../model/HexMap";
import {FullMinerBlock} from "../model/FullMinerBlock";
import {Contract} from "../model/Contract";
import {Token} from "../model/Token";
import {Op, QueryTypes, Sequelize, Transaction} from "sequelize";
import {batchBlockDetail, initCfxSdk} from "./common/utils";
import {base64ToPNG, getImageDir, saveOssUrl, uploadOss} from "./tool/TokenTool";
import {aggregateTransfer, Erc20Transfer} from "../model/Erc20Transfer";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {TraceCreateContract, ContractDestroy} from "../model/TraceCreateContract";
import {ContractVerify} from "../model/ContractVerify";
import {toBase32} from "./tool/AddressTool";
import {CONST} from "./common/constant"
import {AddressTransfer} from "../model/AddrTransfer";
import {Errors} from "./common/LogicError";
import {NftMeta} from "./nftchecker/NftMetaStorage";
import {CensorItem} from "../model/CensorItem";
import {CENSOR_TYPE} from "./censor/CensorService";
import {NameTag} from "../model/NameTag";
import {decodeTransferFromReceipts} from "../TokenTransferSync";
import {AddressNftTransfer, NftTransfer} from "../model/NftTransfer";
import {AddressNfts} from "../model/AddrNft";
import {
    CONTRACT_ADDRESS_METADATA,
    CONTRACT_ANNOUNCEMENT,
    KEY_EPOCH_CIP1559_ENABLED,
    KV
} from "../model/KV";
import {StatOnRealtime} from "./timerstat/StatOnRealtime";
const { format, sign } = require('js-conflux-sdk');
const lodash = require('lodash');
const zlib = require('zlib');

const FIELDS_TOKEN_BASIC = ['name', 'symbol', 'decimals', 'granularity', 'totalSupply'];
const FIELDS_TOKEN_REGISTER = ['icon', 'website', 'ipfsGateway', 'quoteUrl'];
const FIELDS_TOKEN = [...['hex40id', 'base32'], ...FIELDS_TOKEN_BASIC, ...FIELDS_TOKEN_REGISTER];

const FIELDS_CONTRACT_REGISTER = ['name', 'website', 'abi', 'sourceCode'];
const FIELDS_CONTRACT = [...['hex40id', 'base32'], ...FIELDS_CONTRACT_REGISTER];

const INTERNAL_ADMIN_CONTROL = '0x0888000000000000000000000000000000000000';
const SELECTOR_DESTROY = '0x00f55d9d';
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
    public static SYNC_NAME_TAG = true;
    public static SYNC_NFT_TRANSFER = true;
    public static SYNC_ADDR_NFT_TRANSFER = true;
    public static SYNC_ADDR_NFT = true;

    public static CONTRACT_ANNOUNCEMENT
    public static CONTRACT_ADDRESS_METADATA // Notice: Adjust config when proxy contract is changed
    public static erc721Interface = [0x80, 0xac, 0x58, 0xcd];
    public static erc1155Interface = [0xd9, 0xb6, 0x7a, 0x26];
    public static NAME_TAG_SPLIT = "__,__";

    protected app;
    private statOnRealtime: StatOnRealtime
    private NAME_TYPE_MAP;
    private readonly statSwitch
    private latestVoteParams: VoteParams

    public metric = {
        startEpoch: 0,
        currentEpoch: 0,
    };
    private m(step, startTime){
        if(!this.debug) {
            return
        }

        const runTimes = this.metric[step];
        const elapsedTime = this.metric[`${step}_ms`];
        const elapsedDelta = Date.now() - startTime;
        this.metric[step] = runTimes === undefined ? 1 : runTimes + 1;
        this.metric[`${step}_ms`] = elapsedTime === undefined ? elapsedDelta : (elapsedTime + elapsedDelta);

        const epochDelta = this.metric.currentEpoch - this.metric.startEpoch
        if(epochDelta > 0 && epochDelta % 1000 === 0) {
            console.log(`metrics-----------------------------------`);
            console.log(JSON.stringify(this.metric));
            const keys = Object.keys(this.metric)
            let timeS = 0
            let cntrS = 0
            for (const key of keys) {
                if(key.endsWith("ms")) {
                    timeS = timeS + this.metric[key]
                    cntrS++
                }
            }
            console.log(`save overall ------ ${timeS} ${cntrS}`);
            console.log(`------------------------------------------`);
            this.metric = {
                startEpoch: 0,
                currentEpoch: 0
            };
        }

        return Date.now();
    }

    constructor(app: StatApp | any) {
        super(app);
        this.app = app;
        this.NAME_TYPE_MAP = lodash.keyBy(Object.values(CONST.ADDRESS_TRANSFER_TYPE), 'name');
        this.statOnRealtime = new StatOnRealtime()
        this.statSwitch = true;
    }

    public async mustInit() {
        await this.checkConfig()
        await this.loadLatestVoteParam()
    }

    private async checkConfig() {
        const [announcement, addressMetadata, epochCIP1559Enabled] = await Promise.all([
            KV.getString(CONTRACT_ANNOUNCEMENT, ''),
            KV.getString(CONTRACT_ADDRESS_METADATA, ''),
            KV.getNumber(KEY_EPOCH_CIP1559_ENABLED),
        ])

        if(!announcement) {
            console.log(`Failed to load config for Announcement contract!`)
            process.exit(9)
        }
        if(!addressMetadata) {
            console.log(`Failed to load config for AddressMetadata contract!`)
            process.exit(9)
        }
        EpochSync.CONTRACT_ANNOUNCEMENT = format.hexAddress(announcement)
        EpochSync.CONTRACT_ADDRESS_METADATA = format.hexAddress(addressMetadata)

        if(!CONST.NETWORKS_CIP1559_ENABLED.includes(StatApp.networkId)) {
            StatApp.epochCIP1559Enabled = 0
        } else{
            if(!epochCIP1559Enabled) {
                console.log(`Failed to load config for epoch number at which CIP1559 enabled!`)
                process.exit(9)
            }
            StatApp.epochCIP1559Enabled = epochCIP1559Enabled
        }
    }

    private async loadLatestVoteParam() {
        this.latestVoteParams = await VoteParams.findOne({order: [['epoch', 'desc']]})
    }

    //----------------- implementation method from SyncBase -----------------
    public async getData(epochNumber): Promise<SyncData> {
        const {
            app: { tokenTool },
        } = this;

        if(this.metric.startEpoch === 0) {
            this.metric.startEpoch = epochNumber
        }
        let s = Date.now();
        try{
            const epochData = await this.getEpochData(epochNumber);
            s = this.m('EpochData', s)
            const {epoch, blockHashArray, blockArray, transactionArray, transactionHashArray, receipts} = epochData;
            const epochTimestamp = epoch.timestamp;

            const minerBlockArray = await this.getMinerBlockArray(epochNumber, blockArray);
            s = this.m('MinerBlock', s)
            const adminDestroyTxArray = await this.getAdminDestroyTxArray(blockArray, epochTimestamp);
            s = this.m('AdminDestroy', s)

            /*const eventLogInfo = await this.getLogsGrouped({epochNumber, epochTimestamp});*/
            const eventLogInfo = await this.decodeLogFromReceipts(epochNumber, receipts, blockHashArray)
            s = this.m('Logs', s)
            const announceInfo = await this.getAnnounceInfo(epochNumber, eventLogInfo.announcementArray);
            s = this.m('Announce', s)
            const nameTagInfo = await this.getNameTagInfo(epochNumber, eventLogInfo.nameTagArray, eventLogInfo.labelArray)
            const bytes32NameTagInfo = await this.getBytes32NameTagInfo(epochNumber, eventLogInfo.byte32NameTagArray)
            s = this.m('NameTag', s)

            let traceArray = [];
            if (!this.app.config?.traceNotAvailable){
                const traces = await Promise.all(blockHashArray.map(hash=>{
                    return this.app.cfx.traceBlock(hash)
                }));
                traceArray = this.composeTraceAndBock(epochNumber, blockArray, traces);
                // This function will repeatedly fetch the block hashes and details.
                // await this.getTraceArray(epochNumber);
            }
            s = this.m('Trace', s)
            const createArray = await this.getTraceCreateArrayPlus(traceArray);
            s = this.m('TraceCreate', s)
            const traceCreateArray = await this.buildTraceCreateArray(createArray);
            s = this.m('TraceCreateDB', s)
            const crossSpaceArray = await this.getTraceCrossSpaceArray(traceArray);
            s = this.m('TraceCrossSpace', s)
            const traceCrossSpaceArray = await this.getTraceCrossSpaceArrayDB(crossSpaceArray);
            s = this.m('TraceCrossSpaceDB', s)

            const {t20, t721, t1155} = decodeTransferFromReceipts(receipts, tokenTool, epochTimestamp, blockHashArray);
            s = this.m('Transfer', s)
            await this.statByTokenTransfer(epochNumber, epochTimestamp,{t20, t721, t1155})
            s = this.m('statTokenTransfer', s)
            const t20Aggregated = aggregateTransfer(t20)
            s = this.m('Aggregate', s)
            const tokenLogs = {
                transfer20Array: t20Aggregated.filter(t => t.value && t.value > BigInt(0)),
                transfer721Array: t721,
                transfer1155Array: t1155.filter(t => t.value && t.value > BigInt(0)),
            };
            const tokenArray = await this.getTokensAutoDetected(tokenLogs);
            s = this.m('TokensDetected', s)

            const tokenTransferArray = await this.getTokenTransferArrayDB(epochTimestamp, blockHashArray, tokenLogs, true);
            s = this.m('TokenTransfer', s)
            const cfxTransferArray = await this.getCFXTransferArrayDB(epochTimestamp, blockHashArray, traceArray);
            s = this.m('CFXTransfer', s)
            const txArray = await EpochSync.getTransactionArrayDB(blockArray, epochTimestamp);
            s = this.m('Transaction', s)
            const addrTransferArray = await this.getAddrTransferArrayDB(epochNumber, epochTimestamp, tokenTransferArray,
                cfxTransferArray, txArray);
            s = this.m('AddrTransfer', s)

            const transferredNftArray = this.getTransferredNftArray(epochNumber, addrTransferArray);
            s = this.m('Nft', s)
            const nftTransferArray = await this.getNftTransferArray(epochNumber, tokenTransferArray);
            s = this.m('NftTransfer', s)
            const addrNftTransferArray = await this.getAddrNftTransferArray(epochNumber,tokenTransferArray);
            s = this.m('AddrNftTransfer', s)

            const censorItemArray = this.getCensorItemArray(epoch, transactionHashArray);
            this.m('Censor', s)
            const voteParams = StatApp.isEVM ? undefined : await this.getVoteParams(epochNumber)

            return {
                syncCode: SyncCode.SUCCESS,
                parentHash: epoch.parentHash,
                pivotHash: epoch.pivotHash,
                modelData: {epoch, blockArray, minerBlockArray, announceInfo, tokenArray, nameTagInfo, traceCreateArray,
                    traceCrossSpaceArray, adminDestroyTxArray, addrTransferArray, transferredNftArray, censorItemArray,
                    nftTransferArray, addrNftTransferArray, transactionArray, bytes32NameTagInfo, voteParams
                },
            };
        }catch(error) {
            return {syncCode: SyncCode.RETRY, message: `${error}`};
        }
    }

    async save(epochNumber, modelData) {
        let s = Date.now()
        let veryS = s
        const { tokenQuery } = this.app;
        await this.updateCursor(modelData.epoch.timestamp)
        s = this.m('UpdateCursor', s)
        await Epoch.sequelize.transaction(async (dbTx) => {
            EpochSync.SYNC_EPOCH && await Epoch.create(modelData.epoch, {transaction: dbTx});
            s = this.m('Epoch-c', s)
            EpochSync.SYNC_BLOCK && await FullMinerBlock.bulkCreate(modelData.minerBlockArray, {transaction: dbTx});
            s = this.m('MinerBlock-c', s)
            EpochSync.SYNC_ANNOUNCE && await EpochSync.saveAnnounceInfo(epochNumber, modelData.announceInfo, dbTx);
            s = this.m('Announce-c', s)
            EpochSync.SYNC_TRACE && await TraceCreateContract.bulkCreate(modelData.traceCreateArray, {
                updateOnDuplicate:["epochNumber","blockTime","txHash","traceIndex"],
                transaction: dbTx
            });
            s = this.m('Trace-c', s)
            EpochSync.SYNC_TRANSFER && await AddressTransfer.bulkCreate(modelData.addrTransferArray, {transaction: dbTx});
            s = this.m('AddressTransfer-c', s)
            EpochSync.SYNC_DESTROY && await ContractDestroy.bulkCreate(modelData.adminDestroyTxArray, {
                updateOnDuplicate:["epochNumber","blockTime","txHash","admin"],
                transaction: dbTx,
            });
            s = this.m('ContractDestroy-c', s)
            EpochSync.SYNC_TRANSFERRED_NFT && await NftMeta.bulkCreate(modelData.transferredNftArray, {
                updateOnDuplicate:["epochNumber"],
                transaction: dbTx,
            });
            s = this.m('NftMeta-c', s)
            EpochSync.SYNC_CENSOR_ITEM && await CensorItem.bulkCreate(modelData.censorItemArray, {
                updateOnDuplicate:["epochNumber", "censorType", "censorStatus", "createdAt", "updatedAt"],
                transaction: dbTx,
            });
            s = this.m('CensorItem-c', s)
            EpochSync.SYNC_ADDR_NFT && await this.saveAddressNft(epochNumber, modelData, dbTx);
            s = this.m('AddressNft-c', s)
            EpochSync.SYNC_NFT_TRANSFER && await NftTransfer.bulkCreate(modelData.nftTransferArray, {transaction: dbTx});
            s = this.m('NftTransfer-c', s)
            EpochSync.SYNC_ADDR_NFT_TRANSFER && await AddressNftTransfer.bulkCreate(modelData.addrNftTransferArray,
                {transaction: dbTx});
            s = this.m('AddressNftTransfer-c', s)
            const tokenArray = modelData.tokenArray;
            for(const token of tokenArray){
                if(!EpochSync.SYNC_TOKEN_DETECT) break;
                if(token?.name?.length > 64) token.name = token.name.substr(0, 64);
                await Token.upsert(token);
            }
            s = this.m('Token-c', s)
            const nameTagArray = [...modelData.nameTagInfo, ...modelData.bytes32NameTagInfo]
            for (const nameTag of nameTagArray) {
                if(!EpochSync.SYNC_NAME_TAG) break;
                console.log('epoch-sync.nameTag', nameTag);
                await NameTag.upsert(nameTag);
            }
            s = this.m('NameTag-c', s)
        });

        const addressArray = [
            ...modelData.announceInfo.tokenArray.map(item => item.base32),
            ...modelData.tokenArray.map(item => item.base32)
        ];
        for(const address of addressArray){
            if(!EpochSync.SYNC_TOKEN_AUDIT) break;
            await tokenQuery.audit({address}).catch(e => console.log(`epoch-sync.audit, address:${address}`, e));
        }
        s = this.m('Audit-c', s)

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
        s = this.m('Image-c', s)

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
            await this.linkVerify({address, codeHash}).catch(e => console.log(`[${address}]epoch-sync.linkVerify`, e));
        }
        s = this.m('Verify-c', s)

        const traceCrossSpaceArray = modelData.traceCrossSpaceArray;
        for(const traceCrossSpace of traceCrossSpaceArray){
            if(!EpochSync.SYNC_EVM_ADDR) break;
            if(traceCrossSpace.fromSpace === 'evm'){
                await ESpaceHex40Map.create({hexId: traceCrossSpace.from, hex: traceCrossSpace.fromHex.substr(2)})
                    .catch(() => undefined);
            }
            if(traceCrossSpace.toSpace === 'evm'){
                await ESpaceHex40Map.create({hexId: traceCrossSpace.to, hex: traceCrossSpace.toHex.substr(2)})
                    .catch(() => undefined);
            }
        }
        s = this.m('ESpaceHex-c', s)

        this.realtimeStat(modelData.epoch, 'push', modelData.transactionArray, modelData.blockArray.pop())
        veryS = this.m('Save-overall', veryS)
        this.metric.currentEpoch = epochNumber
        s = this.m('RealtimeStat-c', s)

        if (modelData?.voteParams) { // The record will be added only when any one of vote params changes.
            const {storagePointProp: s, baseFeeShareProp: b} = modelData.voteParams
            if ((!this.latestVoteParams && (s >= 0 || b >= 0)) ||
                (this.latestVoteParams && (this.latestVoteParams.storagePointProp != s || this.latestVoteParams.baseFeeShareProp != b))) {
                await VoteParams.create({epoch: epochNumber, storagePointProp: s, baseFeeShareProp: b, timestamp: modelData.epoch.timestamp})
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
            const addrNftDel = await this.deleteAddressNft(epochNumber, modelData, dbTx);
            const nftTransferDel = await NftTransfer.destroy({where: {epoch: epochNumber}, transaction: dbTx});
            const addrNftTransferDel = await AddressNftTransfer.destroy({where: {epoch: epochNumber}, transaction: dbTx});
            const voteParamsDel = await VoteParams.destroy({where: {epoch: epochNumber}, transaction: dbTx});
            console.log(`epoch-sync.delete epoch ${epochNumber} epochDel ${epochDel} minerBlockDel ${minerBlockDel}
                traceCreateDel ${traceCreateDel} addrTransferDel ${addrTransferDel} contractDestroyDel ${contractDestroyDel}
                censorItemDel ${censorItemDel} addrNftDel ${addrNftDel} nftTransferDel ${nftTransferDel} 
                addrNftTransferDel ${addrNftTransferDel} voteParamsDel${voteParamsDel}`);
        });

        this.realtimeStat(modelData.epoch, 'pop')
    }

    //------------------- business method for miner block --------------------
    public async getMinerBlockArray(epochNumber, blockArray) {
        const {
            app: { config },
        } = this;

        let minerBlockArray = await Promise.all(blockArray.map(async (block: any, position) => {
            const hex40 = format.hexAddress(block.miner);
            const blockDt = new Date(block.timestamp * 1000);
            const hex40Id = (await makeId(hex40, undefined, {dt: blockDt})).id;
            const epoch = (epochNumber === 0 && config.conflux.consortiumMode) ? 0 : block.epochNumber;
            return {minerId: hex40Id, epoch, position, createdAt: blockDt};
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
                    const contract = this.decodeContractDestroy(data);
                    const destroyTx = {epochNumber, blockTime, txHash: hash.substr(2), admin: fromHex.substr(2),
                        contract: contract.substr(2)};
                    adminDestroyTxArray.push(destroyTx);
                }
            }
        }

        return adminDestroyTxArray;
    }

    private decodeContractDestroy(data){
        // e.g. https://testnet.confluxscan.net/transaction/0xf862048e4112a836dae6d4b4c5fcc091db5bb68470559e29db5b8982f9e44a30
        // data : 0x00f55d9d000000000000000000000000896cf0fc19b6c045d287391969cad1477512eebf
        // 0x  method    (bytes32     address)
        // 2 +   8 +     (64        -  40)
        return '0x'+data.substr(34)
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
                await this.parseAnnounce(epochNumber, params, announce, tokenMap);
            }
            if(params[0] === 'contract') {
                await this.parseAnnounce(epochNumber, params, announce, contractMap);
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

    private async parseAnnounce(epochNumber, params, announce, map){
        const contract = params[1] === 'list' ? params[2] : params[1]
        const valid = await this.checkAnnounce(epochNumber, announce['address'], announce['announcer'], contract)
        if(!valid) {
            return map
        }

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
            const decodedBase64 = Buffer.from(announce.value, 'base64');
            if (isBlob) {
                let flatZip: Buffer;
                try {
                    flatZip = zlib.unzipSync(decodedBase64);
                } catch (e) {
                    console.log(`failed to unzip, field [${field}], epoch [${epochNumber}]`, e)
                    return map;
                }
                item[field] = Buffer.from(flatZip).toString();
            } else {
                item[field] = decodedBase64.toString();
            }

            if (field === 'name' && item[field].length >= 255) {
                item[field] = item[field].substr(0, 255);
            }
            console.log(`announce---epoch:${epochNumber}---${params}---${isBlob ? (item[field])?.length : item[field]}`);

            map[hex] = item;
        }
        return map;
    }

    private async checkAnnounce(epochNumber, announcement, announcer, contract) {
        const hexAnnouncement = format.hexAddress(announcement)
        if(hexAnnouncement !== EpochSync.CONTRACT_ANNOUNCEMENT) {
            console.log(`checkAnnounce epoch ${epochNumber} announcement ${announcement} not match with config ${EpochSync.CONTRACT_ANNOUNCEMENT}`)
            return false
        }

        const creator = await Hex40Map.sequelize.query(`select hex
        from hex40
        where id = (
        select fromId from full_tx
        where hash = (
        select CONCAT('0x', txHash) from trace_create_contract
        where \`to\` = (select id from hex40 where hex = ?)
        )
        )`, {
            type: QueryTypes.SELECT, replacements: [contract.substr(2)], logging: sql => console.log(`announce sql ${sql}`)
        }).then(array => {
            return array?.length ? array[0]['hex'] : undefined;
        });
        const hexAnnouncer = format.hexAddress(announcer).substr(2)
        if(hexAnnouncer !== creator) {
            console.log(`checkAnnounce epoch ${epochNumber} announcer ${hexAnnouncer} not match with creator ${creator}`)
            return false
        }

        return true
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

    // --------------------- business method for name tag -----------------------
    private async getNameTagInfo(epochNumber, nameTagArray, labelArray) {
        nameTagArray = nameTagArray.filter(item => this.checkAddrMeta(epochNumber, item['address']))
        labelArray = labelArray.filter(item => this.checkAddrMeta(epochNumber, item['address']))
        const base32Array = [...nameTagArray, ...labelArray].map(i => format.address(i.addr, StatApp.networkId));
        if(!base32Array?.length) {
            return [];
        }

        const nameTagDbArray = await NameTag.findAll({where: {base32: {[Op.in]: base32Array}}, raw: true});
        const nameTagMap = lodash.keyBy(nameTagDbArray, 'base32');
        Object.keys(nameTagMap).forEach(base32 => {
            const nameTag = nameTagMap[base32];
            nameTag.labels = new Set(nameTag.labels ? nameTag.labels.split(EpochSync.NAME_TAG_SPLIT) : []);
        });

        for(const item of nameTagArray) {
            const {auditor, addr, newNameTag, newWebsite, newDesc} = item;
            const base32 = format.address(addr, StatApp.networkId);
            if(!nameTagMap[base32]) {
                nameTagMap[base32] = {base32, auditor, epoch: epochNumber, labels: new Set()};
            }
            nameTagMap[base32].nameTag = newNameTag;
            nameTagMap[base32].website = newWebsite;
            nameTagMap[base32].desc = newDesc;
        }
        for (const item of labelArray) {
            const {auditor, addr, oldLabel, newLabel} = item;
            const base32 = format.address(addr, StatApp.networkId);
            if(!nameTagMap[base32]) {
                nameTagMap[base32] = {base32, auditor, epoch: epochNumber, labels: new Set()};
            }
            if(!oldLabel && newLabel) { // add
                nameTagMap[base32].labels.add(newLabel);
            }
            if(oldLabel && newLabel) { // update
                nameTagMap[base32].labels.delete(oldLabel);
                nameTagMap[base32].labels.add(newLabel);
            }
            if(oldLabel && !newLabel) { // delete
                nameTagMap[base32].labels.delete(oldLabel);
            }
        }

        const addressInfoArray = await Promise.all(base32Array.map(async base32 => {
            const hex40 = format.hexAddress(base32);
            const hex40id = (await makeId(hex40)).id;
            return {base32, hex40, hex40id};
        }));
        const addressInfoMap = lodash.keyBy(addressInfoArray, 'base32');
        const contractIdArray = await TraceCreateContract.findAll({
            attributes: ['to'], where: {to: {[Op.in]: addressInfoArray.map(item => item['hex40id'])}}, raw: true});
        const contractIdSet = new Set<number>(contractIdArray.map(item => item.to));

        return Object.values(nameTagMap).map(item => {
            item['hex40id'] = addressInfoMap[item['base32']].hex40id;
            item['eoa'] = !contractIdSet.has(addressInfoMap[item['base32']].hex40id);
            item['auditor'] = format.address(item['auditor'], StatApp.networkId);
            item['labels'] = [...item['labels']].join(EpochSync.NAME_TAG_SPLIT);
            return item;
        });
    }

    private async getBytes32NameTagInfo(epochNumber, nameTagArray) {
        nameTagArray = nameTagArray.filter(item => this.checkAddrMeta(epochNumber, item['address']))
        if(!nameTagArray?.length) {
            return []
        }

        const hex64Array = nameTagArray.map(item => item.hex64.substr(2))
        const nameTagDbArray = await NameTag.findAll({where: {base32: {[Op.in]: hex64Array}}, raw: true})
        const nameTagMap = lodash.keyBy(nameTagDbArray, 'base32')

        for(const item of nameTagArray) {
            const {auditor, hex64: prefixedHex64, newNameTag, newWebsite, newDesc} = item
            const hex64 = prefixedHex64.substr(2)
            if(!nameTagMap[hex64]) {
                nameTagMap[hex64] = {base32: hex64, auditor, epoch: epochNumber}
            }
            nameTagMap[hex64].nameTag = newNameTag
            nameTagMap[hex64].website = newWebsite
            nameTagMap[hex64].desc = newDesc
        }

        return Object.values(nameTagMap).map(item => {
            item['hex40id'] = 0
            item['eoa'] = false
            item['auditor'] = format.address(item['auditor'], StatApp.networkId)
            return item
        })
    }

    private checkAddrMeta(epochNumber, addrMeta) {
        const hexAddrMeta = format.hexAddress(addrMeta)
        if(hexAddrMeta !== EpochSync.CONTRACT_ADDRESS_METADATA) {
            console.log(`checkAddrMeta epoch ${epochNumber} addrMetadata ${hexAddrMeta} not match with config ${EpochSync.CONTRACT_ADDRESS_METADATA}`)
            return false
        }
        return true
    }

    // ---------------------------- address transfer ----------------------------
    public async getAddrTransferArrayDB(epochNumber,epochTimestamp,tokenTransferArray,cfxTransferArray,txArray){
        const result = [];
        let index = 0;

        [...txArray, ...cfxTransferArray, ...tokenTransferArray].forEach( transfer => {
            lodash.assign(transfer, {cursorId: EpochSync.buildAddrTransferCursorTs(epochNumber, index)})
            index++
            if(transfer.contractCreatedId) {
                lodash.assign(transfer, {contractId: transfer.contractCreatedId})
            }
            result.push({...transfer, addressId: transfer.fromId})

            const dummyToId = transfer.toId || transfer.contractCreatedId
            if (dummyToId && dummyToId !== transfer.fromId) {
                result.push({...transfer, addressId: dummyToId})
            }
        });

        return result;
    }

    public static buildAddrTransferCursor(t) {
        function pad(val, len, isEnd=false) {
            const v = val.toString()
            return isEnd ? v.padEnd(len, '0') : v.padStart(len, '0');
        }
        return `${t.epoch}${pad(t.blockIndex, 4)}${pad(t.txIndex, 5)}${pad(t.txLogIndex, 6)}${pad(t.type, 3, true)}`;
    }

    public static buildAddrTransferCursorTs(epochNumber, index) {
        function pad(val, len, isEnd=false) {
            const v = val.toString()
            return isEnd ? v.padEnd(len, '0') : v.padStart(len, '0');
        }
        return `${epochNumber}${pad(index, 6)}`;
    }

    public static async getTransactionArrayDB(blockArray, epochTimestamp){
        const result = [];
        for(const [blockIndex, block] of blockArray.entries()){
            if(!block.transactions?.length) {
                continue;
            }

            let txPosition = 0;
            for (const [txIndex, item] of block.transactions.entries()){
                const receiptStatus = item.receipt?.outcomeStatus;
                if (receiptStatus != 0 && receiptStatus != 1 && block.epochNumber !== 0) {
                    continue;
                }

                const tx = {} as any;
                tx.epoch = block.epochNumber;
                tx.blockIndex = blockIndex;
                tx.txIndex = txPosition++;

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
                result.push(lodash.defaults(tx, {txLogIndex: 0, batchIndex: 0, contractId: 0, tokenId: 0}));
            }
        }
        return result;
    }

    public async getCFXTransferArrayDB(epochTimestamp, blockHashArray, traceArray) {
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

    public async buildTraceCreateArray(traceCreateArray) {
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
        if (this.app.config?.traceNotAvailable) {
            return []
        }

        const [blockArray, traceArray2d] = await this.getBlockArray(epochNumber);
        return this.composeTraceAndBock(epochNumber, blockArray, traceArray2d, detail);
    }
    public composeTraceAndBock(epochNumber, blockArray, traceArray2d, detail = false) {
        if (this.app.config?.traceNotAvailable) {
            return []
        }
        const {app: {tokenTool},} = this;
        let traceArray = [];
        blockArray.forEach((block, idx) => {
            if (!block.transactions.length) {
                return;
            }

            const blockTrace:any = traceArray2d[idx]
            if (!blockTrace) {
                // no trace at block
                return traceArray;
            }

            // add check
            if(block.epochNumber !== epochNumber || blockTrace.epochNumber !== epochNumber) {
                throw new Error(`[epoch=${epochNumber}]mismatch between block and blockTrace`);
            }

            // assemble traces
            let txPosition = 0;
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
                            transactionIndex: txPosition,
                            transactionTraceIndex,
                            status: transaction.status,
                            ...EpochSync.parseTrace(trace, detail),
                        });
                    });
                    const matchedTrace = tokenTool.matchTrace(transactionTraceArray, transaction);
                    traceArray = [...traceArray, ...matchedTrace];
                    transaction.blockHash && txPosition ++;
                });
        });
        return traceArray;
    }

    private async getBlockArray(epochNumber) : Promise<any[]> {
        const {
            app: { cfx, config },
        } = this;

        const blockHashArray = await cfx.getBlocksByEpochNumber(epochNumber);
        const [blockArray, traceArray] = await batchBlockDetail(cfx, blockHashArray, config.conflux.consortiumMode);
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

    /*public static matchTrace(transactionTraceArray, transaction){
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
    }*/

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
            proxyVerify = lodash.assign(verify, {name: '__MinimalProxy__', version: '__version__'});
        } else{
            proxyVerify = lodash.assign(implVerify, verify, {id: undefined, similarMatch: undefined, guid: undefined});
        }
        await ContractVerify.create(proxyVerify);

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

    // ----------------------------- nft transfer -------------------------------
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

    // ------------------------------ address nft -------------------------------
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

        /*let cursor: number;
        async function nextCursor() {
            if(cursor === undefined) {
                const start = Number(`${epochTimestamp.getTime().toString().substring(0, 10)}${''.padStart(6, '0')}`);
                const end = start + Number(`${'1'.padEnd(7, '0')}`);
                const maxCursor: number = (await AddressNfts.max('updatedCursor', {where: {
                        [Op.and]: [{updatedCursor: {[Op.gte]: start}}, {updatedCursor: {[Op.lt]: end}}]}})) || (start - 1);
                cursor = maxCursor + 1;
            }
            return cursor++;
        }*/

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
            /*const updatedCursor = await nextCursor();*/
            const updatedCursor = ++ this.addrNftCursor
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

    private addrNftCursor: number
    private async updateCursor(epochTimestamp) {
        const start = Number(`${epochTimestamp.getTime().toString().substring(0, 10)}${''.padStart(6, '0')}`)
        const end = start + Number(`${'1'.padEnd(7, '0')}`)
        const maxCursor: number = (
            await AddressNfts.max('updatedCursor', {
                    where: {
                        [Op.and]: [
                            {updatedCursor: {[Op.gte]: start}},
                            {updatedCursor: {[Op.lt]: end}}
                        ]
                    },
                }
            )
        ) || (
            start - 1
        );
        this.addrNftCursor = maxCursor + 1
    }

    // ----------------------------- realtime stat ------------------------------
    public async startRealtimeStat() {
        await this.statOnRealtime.schedule()
    }

    private realtimeStat(epoch, action, txArray?, pivotBlock?) {
        this.statOnRealtime.setGasInfo(epoch, action, txArray, pivotBlock)
    }

    // ------------------------------ token stat --------------------------------
    private async statByTokenTransfer(epochNumber, epochTimestamp, tokenTransfers) {
        if(!this.statSwitch) {
            return
        }

        let tokenAddrTransfer = {}
        let nftAddrMint = {}
        const transferArray = [
            {transfers: tokenTransfers.t20, type: CONST.TRANSFER_TYPE.ERC20},
            {transfers: tokenTransfers.t721, type: CONST.TRANSFER_TYPE.ERC721},
            {transfers: tokenTransfers.t1155, type: CONST.TRANSFER_TYPE.ERC1155},
        ]
        for (const item of transferArray) {
            const {transfers, type} = item
            for (const transfer of transfers) {
                const addr = transfer.address
                tokenAddrTransfer[addr] = tokenAddrTransfer[addr] ? (tokenAddrTransfer[addr] + 1) : 1
                if ((type === CONST.TRANSFER_TYPE.ERC721 && transfer.topics[1] === CONST.ZERO_VALUE_IN_SLOT)
                    || (type === CONST.TRANSFER_TYPE.ERC1155 && transfer.topics[2] === CONST.ZERO_VALUE_IN_SLOT)) {
                    nftAddrMint[addr] = nftAddrMint[addr] ? (nftAddrMint[addr] + 1) : 1
                }
            }
        }

        let tokenTransfer = {}
        let nftMint = {}
        const addrArray = Object.keys(tokenAddrTransfer)
        for(const addr of addrArray){
            const hex = format.hexAddress(addr)
            const tokenId = (await makeId(hex)).id
            tokenTransfer[tokenId] = [tokenAddrTransfer[addr]]
            nftAddrMint[addr] && (nftMint[tokenId] = [nftAddrMint[addr]])
        }
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

    // ------------------------------ vote params -------------------------------
    private async getVoteParams(epochNumber) {
        const {
            app: { cfx: sdk },
        } = this;

        try{
            return sdk.cfx.getParamsFromVote(epochNumber)
        }catch (err){
            const msg = `${err}`
            if (msg.includes('Invalid parameters: epoch_num')) {
                throw new Error(`[epoch=${epochNumber}]vote params not ready`);
            }
            throw err
        }
    }
}
