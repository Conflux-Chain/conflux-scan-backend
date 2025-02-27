import {Epoch, VoteParams} from "../model/Epoch";
import {SyncBase, SyncCode, SyncData} from "./SyncBase";
import {StatApp} from "../StatApp";
import {
    formatToBase32,
    formatToHex,
    Hex40Map, idHex40Map,
    makeId,
    makeIdV
} from "../model/HexMap";
import {Contract} from "../model/Contract";
import {Token} from "../model/Token";
import {Op, QueryTypes, Transaction} from "sequelize";
import {base64ToPNG, getImageDir, saveOssUrl, uploadOss} from "./tool/TokenTool";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {TraceCreateContract, ContractDestroy, IContractDestroy} from "../model/TraceCreateContract";
import {ContractVerify} from "../model/ContractVerify";
import {toBase32} from "./tool/AddressTool";
import {CONST} from "./common/constant"
import {AddressTransfer, EpochAddressIds} from "../model/AddrTransfer";
import {NftMeta} from "./nftchecker/NftMetaStorage";
import {CensorItem, ICensorItem} from "../model/CensorItem";
import {CENSOR_TYPE} from "./censor/CensorService";
import {NameTag} from "../model/NameTag";
import {EpochHashTokenTransfer} from "../TokenTransferSync";
import {AddressNftTransfer, NftTransfer} from "../model/NftTransfer";
import {AddressNfts, T_ADDRESS_NFTS} from "../model/AddrNft";
import {
    AUTO_VERIFY_CURSOR,
    CONTRACT_ADDRESS_METADATA,
    CONTRACT_ANNOUNCEMENT,
    KEY_EPOCH_CIP1559_ENABLED,
    KV
} from "../model/KV";
import {StatOnRealtime} from "./timerstat/StatOnRealtime";
import {Conflux, CONST as SDK_CONST, format} from "js-conflux-sdk";
import {CfxTransfer, ICfxTransfer} from "../model/CfxTransfer";
import {EpochHashCfxTransfer} from "../CfxTransferSync";
import {sleep} from "./tool/ProcessTool";
import {FullBlock, FullTransaction} from "../model/FullBlock";
const {sign} = require('js-conflux-sdk');
const lodash = require('lodash');
const zlib = require('zlib');
const NodeCache = require( "node-cache" );

const cacheTtl = 60 * 10

const FIELDS_TOKEN_BASIC = ['name', 'symbol', 'decimals', 'granularity', 'totalSupply'];
const FIELDS_TOKEN_REGISTER = ['icon', 'website', 'ipfsGateway', 'quoteUrl'];
const FIELDS_TOKEN = [...['hex40id', 'base32'], ...FIELDS_TOKEN_BASIC, ...FIELDS_TOKEN_REGISTER];

const FIELDS_CONTRACT_REGISTER = ['name', 'website', 'abi', 'sourceCode'];
const FIELDS_CONTRACT = [...['hex40id', 'base32'], ...FIELDS_CONTRACT_REGISTER];

const SELECTOR_DESTROY = '0x00f55d9d';

const REGEX_CODE_EIP1167 = new RegExp(/^0x363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3$/);

const POCKET_TYPES = ['gas_payment', 'storage_collateral', 'sponsor_balance_for_gas', 'sponsor_balance_for_collateral',
    'staking_balance', 'balance'];

export const NAME_TAG_SPLIT = "__,__";

export class EpochSync extends SyncBase {
    protected app: any
    private announcementContract: string
    private addressMetadataContract: string
    private syncCensorItem: boolean
    private transferTypeMap: object
    private latestVoteParams: VoteParams
    private statOnRealtime: StatOnRealtime
    private nodeCache: any
    private adminContractId: number;

    constructor(app: any) {
        super(app)
        this.app = app
        this.statOnRealtime = new StatOnRealtime()
        this.transferTypeMap = lodash.keyBy(Object.values(CONST.ADDRESS_TRANSFER_TYPE), 'name')
	    this.transferTypeMap['internal_transfer_action'] = CONST.ADDRESS_TRANSFER_TYPE.CFX_IN_INTERNAL_BY_BALANCE;
        this.nodeCache = new NodeCache({ maxKeys: 1000,  stdTTL: cacheTtl, checkperiod: 60})
    }

    public async mustInit() {
        this.adminContractId = await makeIdV(CONST.INTERNAL_CONTRACT_MAP.AdminControl);
        await this.checkConfig()
        await this.loadLatestVoteParam()
        this.startAutoVerify().then();
    }

    async startAutoVerify() {
        let delaySec = 0;
        try {
            let lastTraceId = await KV.getNumber(AUTO_VERIFY_CURSOR, -1);
            if (lastTraceId == -1) {
                const cv = await TraceCreateContract.findOne({order: [['id', 'desc']], raw: true});
                if (cv) {
                    lastTraceId = cv.id;
                }
            }
            const tcc = isNaN(lastTraceId) ? null : await TraceCreateContract.findOne({
                where: {id: {[Op.gt]: lastTraceId}}, order: [['id', 'asc']]
            });
            if (!tcc) {
                delaySec = 10;
            } else {
                await this.doContractVerify([tcc]);
                await KV.saveNumber(AUTO_VERIFY_CURSOR, tcc.id, null);
            }
        } catch (e) {
            delaySec = 30;
            console.log(`${__filename} failed to auto verify.`, e)
        }
        setTimeout(()=>this.startAutoVerify(), delaySec * 1000);
    }

    private async checkConfig() {
        const [announcement, addressMetadata, epochCIP1559Enabled] = await Promise.all([
            KV.getString(CONTRACT_ANNOUNCEMENT, CONST.CHAIN_INFO[StatApp.networkId]?.C_ANNOUNCE ?? CONST.ZERO_ADDRESS),
            KV.getString(CONTRACT_ADDRESS_METADATA, CONST.CHAIN_INFO[StatApp.networkId]?.C_META ?? CONST.ZERO_ADDRESS),
            KV.getNumber(KEY_EPOCH_CIP1559_ENABLED, CONST.CHAIN_INFO[StatApp.networkId]?.EPOCH_CIP1559),
        ])

        if (!announcement) {
            console.log(`Failed to load config for Announcement contract!`)
            process.exit(9)
        }
        if (!addressMetadata) {
            console.log(`Failed to load config for AddressMetadata contract!`)
            process.exit(9)
        }
        this.announcementContract = formatToHex(announcement)
        this.addressMetadataContract = formatToHex(addressMetadata)

        if (!CONST.NETWORKS_CIP1559_ENABLED.includes(StatApp.networkId)) {
            StatApp.epochCIP1559Enabled = 0
        } else {
            if (!epochCIP1559Enabled) {
                console.log(`Failed to load config for epoch number at which CIP1559 enabled!`)
                process.exit(9)
            }
            StatApp.epochCIP1559Enabled = epochCIP1559Enabled
        }

        if (this.app.config.censorApiKey && this.app.config.censorSecretKey) {
            this.syncCensorItem = true
        }
    }

    private async loadLatestVoteParam() {
        this.latestVoteParams = await VoteParams.findOne({order: [['epoch', 'desc']]})
    }

    //----------------- implementation method from SyncBase -----------------
    public async getData(epochNumber: number): Promise<SyncData> {

        try {
            const {dbTxArr: txArray, dbPivotBlock} = await this.getTransactionArrayDB(epochNumber);
            const pivotHash = dbPivotBlock.hash;
            let epochData = await this.getEpochData(epochNumber, pivotHash, this.app.cfx);
            const {epoch, transactionArray, receipts, pivotBlock} = epochData
            epochData = null
            const epochTimestamp = epoch.timestamp
            const censorItemArray = this.getCensorItemArray(txArray);

            let [adminDestroyTxArray, eventLogInfo, tokenLogs,
                voteParamArray] = await Promise.all([
                this.getAdminDestroyTxArray(txArray, this.app.cfx),
                this.decodeLogFromReceipts(epochNumber, receipts),
                this.getTokenLogs(pivotHash, epochNumber),
                StatApp.isEVM ? undefined : await this.getVoteParams(epochNumber),
            ])

            let [announceInfo, nameTagArray, bytes32NameTagArray, tokenArray,
                cfxTransferArray, tokenTransferArray] = await Promise.all([
                this.getAnnounceInfo(epochNumber, eventLogInfo.announcementArray),
                this.getNameTagInfo(epochNumber, eventLogInfo.nameTagArray, eventLogInfo.labelArray),
                this.getBytes32NameTagInfo(epochNumber, eventLogInfo.byte32NameTagArray),
                this.getTokensAutoDetected(tokenLogs),
                this.getCFXTransferArrayDB(pivotHash, epochNumber),
                this.getTokenTransferArrayDB(tokenLogs),
            ])
            eventLogInfo = null
            tokenLogs = null

            let [announcedTokenArray, announcedContractArray,
                {transfers: addrTransferArray, epochAddrIdArray}, nftTransferArray,
                addrNftTransferArray] = await Promise.all([
                this.getAnnouncedTokens(epochNumber, announceInfo.tokenArray),
                this.getAnnouncedContracts(epochNumber, announceInfo.contractArray),
                this.getAddrTransferArrayDB(epochNumber, epochTimestamp, tokenTransferArray, cfxTransferArray, txArray),
                this.getNftTransferArray(epochNumber, tokenTransferArray),
                this.getAddrNftTransferArray(epochNumber, tokenTransferArray),
            ])
            cfxTransferArray = null
            tokenTransferArray = null


            let [addressNfts, transferredNftArray] = await Promise.all([
                this.getAddressNft(epochNumber, epochTimestamp, addrNftTransferArray),
                this.getTransferredNftArray(epochNumber, addrTransferArray),
                this.saveTokenIcon(announceInfo),
            ])
            announceInfo = null

            const modelData: any = {
                epoch,
                addrTransferArray,
                epochAddrIdArray,
                nftTransferArray,
                addrNftTransferArray,
                addressNfts,
                voteParamArray,

                announcedTokenArray,
                announcedContractArray,
                adminDestroyTxArray,
                transferredNftArray,
                tokenArray,
                nameTagArray,
                bytes32NameTagArray,

                censorItemArray,
                pivotBlock,
                transactionArray,
            }

            return {
                syncCode: SyncCode.SUCCESS,
                parentHash: epoch.parentHash,
                pivotHash: epoch.pivotHash,
                modelData,
            }
        } catch (error) {
            return {syncCode: SyncCode.RETRY, message: `${error}`, error}
        }
    }

    async saveTokenIcon(announceInfo) {
        try {
            const {tokenArray} = announceInfo;
            const {dir} = getImageDir();
            for (const token of tokenArray) {
                if (token.icon) {
                    const dbIcon = await Token.findOne({where: {base32: token.base32}});
                    setTimeout(() => {
                        base64ToPNG(dbIcon, dir).then(({absPath, filename}) => {
                            return uploadOss(absPath, filename)
                        }).then(res => {
                            return saveOssUrl(dbIcon, res)
                        }).catch(err => {
                            console.log(`epoch-sync.create one TokenIcon url fail: ${token.base32}`, err);
                        })
                    }, 10_000)
                }
            }
        } catch (e) {
            console.log(`epoch-sync, createTokenIcon url fail`, e);
        }
    }

    async doContractVerify(traceCreateArray) {
        for (const traceCreate of traceCreateArray) {
            const hex40 = await Hex40Map.findOne({where: {id: traceCreate.to}});
            const address = `0x${hex40.hex}`;
            const codeHash = traceCreate.codeHash;
            const isEIP1167 = await this.verifyMinimalProxy({address}).catch(e => {
                console.log(`[${address}]epoch-sync.minimalVerify`, e);
                return false;
            });
            if (isEIP1167) continue;
            await this.linkVerify({address, codeHash}).catch(e => console.log(`[${address}]epoch-sync.linkVerify`, e));
        }
    }

    async save(epochNumber, modelData) {
        const voteParamArray = []
        if (modelData?.voteParamArray) { // The record will be added only when any one of vote params changes.
            const {storagePointProp: s, baseFeeShareProp: b} = modelData.voteParamArray
            if ((!this.latestVoteParams && (s >= 0 || b >= 0)) ||
                (this.latestVoteParams && (this.latestVoteParams.storagePointProp != s || this.latestVoteParams.baseFeeShareProp != b))) {
                const v = {
                    epoch: epochNumber, storagePointProp: s, baseFeeShareProp: b, timestamp: modelData.epoch.timestamp
                } as VoteParams
                this.latestVoteParams = v
                voteParamArray.push(v)
            }
        }

        const {catchingUp, needStore} = await this.catchUp.enqueue(modelData, voteParamArray)
        if(needStore) {
            let data = this.catchUp.data()
            await this.saveOnce(data, data.voteParamArray).finally(() => this.catchUp.reset())
            data = null
        }
        if(catchingUp) {
            return
        }

        await this.saveOnce(modelData, voteParamArray)

        this.realtimeStat(modelData.epoch, 'push', modelData.transactionArray, modelData.pivotBlock)
    }

    async saveOnce(modelData, voteParamArray) {
        const epochArray = modelData.epochArray?.length ? modelData.epochArray : [modelData.epoch]
        await Epoch.sequelize.transaction(async (dbTx) => {
            await Promise.all([
                Epoch.bulkCreate(epochArray, {transaction: dbTx}),
                AddressTransfer.bulkCreate(modelData.addrTransferArray, {transaction: dbTx}),
                EpochAddressIds.bulkCreate(modelData.epochAddrIdArray, {transaction: dbTx}),
                NftTransfer.bulkCreate(modelData.nftTransferArray, {transaction: dbTx}),
                AddressNftTransfer.bulkCreate(modelData.addrNftTransferArray, {transaction: dbTx}),
                VoteParams.bulkCreate(voteParamArray, {transaction: dbTx}),

                Token.bulkCreate([...modelData.announcedTokenArray, ...modelData.tokenArray], {transaction: dbTx,
                    updateOnDuplicate: FIELDS_TOKEN as any}),
                Contract.bulkCreate(modelData.announcedContractArray, {transaction: dbTx,
                    updateOnDuplicate: FIELDS_CONTRACT as any}),
                ContractDestroy.bulkCreate(modelData.adminDestroyTxArray, { transaction: dbTx,
                    updateOnDuplicate: ["epochNumber", "blockTime", "txHash", "admin"]}),
                NftMeta.bulkCreate(modelData.transferredNftArray, { transaction: dbTx,
                    updateOnDuplicate: ["epochNumber"]}),
                NameTag.bulkCreate([...modelData.nameTagArray, ...modelData.bytes32NameTagArray], {transaction: dbTx,
                    updateOnDuplicate: ["eoa", "auditor", "epoch", "nameTag", "website", "desc", "labels"]}),

                this.syncCensorItem ? CensorItem.bulkCreate(modelData.censorItemArray, { transaction: dbTx,
                        updateOnDuplicate: ["epochNumber", "censorType", "censorStatus", "createdAt", "updatedAt"],})
                    : undefined as any,

                modelData.addressNfts.replacements.length ? AddressNfts.sequelize.query(`
                    insert into ${T_ADDRESS_NFTS}(addressId, contractId, tokenId, type, value, updatedCursor, 
                        createdAt, updatedAt)
                    values
                        ${lodash.join(modelData.addressNfts.placeholders)} 
                    on duplicate key update
                        value = value + values(value),
                        updatedCursor = values(updatedCursor),
                        updatedAt = values(updatedAt)`, {
                    type: QueryTypes.UPDATE,
                    replacements: modelData.addressNfts.replacements,
                    transaction: dbTx,
                }): undefined as any,
            ])
        })
        modelData = null
        voteParamArray = null
    }

    async delete(epochNumber, modelData) {
        const epochAddressIds = await EpochAddressIds.findAll({where: {epoch: epochNumber}, raw: true})
        const addrIds = epochAddressIds.map(epochAddressId => epochAddressId.addressId)

        await Epoch.sequelize.transaction(async (dbTx) => {
            const [epochDel, addrTransferDel, epochAddressDel, contractDestroyDel,
                censorItemDel, addrNftDel, nftTransferDel, addrNftTransferDel, voteParamsDel] = await Promise.all([
                Epoch.destroy({where: {epoch: epochNumber}, transaction: dbTx}),
                addrIds?.length ? AddressTransfer.destroy({
                    where: {addressId: {[Op.in]: addrIds}, epoch: epochNumber},
                    transaction: dbTx
                }) : 0 as any,
                addrIds?.length ? EpochAddressIds.destroy({where: {epoch: epochNumber}, transaction: dbTx}) : 0 as any,
                ContractDestroy.destroy({where: {epochNumber}, transaction: dbTx}),
                CensorItem.destroy({where: {epochNumber}, transaction: dbTx}),
                this.deleteAddressNft(epochNumber, modelData.epoch.timestamp, dbTx),
                NftTransfer.destroy({where: {epoch: epochNumber}, transaction: dbTx}),
                AddressNftTransfer.destroy({where: {epoch: epochNumber}, transaction: dbTx}),
                VoteParams.destroy({where: {epoch: epochNumber}, transaction: dbTx}),
            ])
            console.log(`epoch-sync.delete epoch ${epochNumber} epochDel ${epochDel} 
                addrTransferDel ${addrTransferDel} epochAddressDel ${epochAddressDel} 
                contractDestroyDel ${contractDestroyDel} censorItemDel ${censorItemDel} addrNftDel ${addrNftDel} 
                nftTransferDel ${nftTransferDel} addrNftTransferDel ${addrNftTransferDel} voteParamsDel${voteParamsDel}`);
        });

        this.realtimeStat(modelData.epoch, 'pop')
    }



    //---------------- business method for admin destroy tx ------------------
    async getAdminDestroyTxArray(txArray:FullTransaction[], cfx: Conflux) {
        const adminDestroyTxArray:IContractDestroy[] = [];
        for (const dbTx of txArray) {
            const {createdAt, hash, fromId, toId, epoch, blockPosition, txPosition, status} = dbTx;
            if (toId !== this.adminContractId || status !== 0) {
                continue;
            }
            let useHash = hash;
            const rawTx = await cfx.getTransactionByHash(useHash);
            const data = rawTx.data;
            if (data.startsWith(SELECTOR_DESTROY)) {
                const fromHex = await Hex40Map.findByPk(fromId).then(res=>res?.hex);
                const contract = EpochSync.decodeContractDestroy(data);
                if (!contract) {
                    continue;
                }
                const destroyTx: IContractDestroy = {
                    epochNumber: epoch, blockTime: createdAt, txHash: useHash.substr(2), admin: fromHex,
                    contract: contract.substr(2)
                };
                adminDestroyTxArray.push(destroyTx);
            }
        }

        return adminDestroyTxArray;
    }

    public static decodeContractDestroy(data) {
        // e.g. https://testnet.confluxscan.net/transaction/0xf862048e4112a836dae6d4b4c5fcc091db5bb68470559e29db5b8982f9e44a30
        // data : 0x00f55d9d000000000000000000000000896cf0fc19b6c045d287391969cad1477512eebf
        // 0x  method    (bytes32     address)
        // 2 +   8 +     (64        -  40)
        return data?.length == 74 ? '0x' + data.substr(34) : '';
    }

    //--------------------- business method for announce ---------------------
    private static async saveAnnounceInfo(epochNumber, {tokenArray, contractArray}, dbTx: Transaction = undefined) {
        for (const token of tokenArray) {
            let t = lodash.defaults({updatedAt: new Date()}, lodash.pick(token, FIELDS_TOKEN));
            await Token.upsert(t, {transaction: dbTx});
        }
        for (const contract of contractArray) {
            let c = lodash.defaults({
                epoch: epochNumber,
                updatedAt: new Date()
            }, lodash.pick(contract, FIELDS_CONTRACT));
            await Contract.upsert(c, {transaction: dbTx});
        }
    }

    private getAnnouncedTokens(epochNumber, tokenArray) {
        return tokenArray.map(t => lodash.defaults({
            epoch: epochNumber,
            updatedAt: new Date()
        }, lodash.pick(t, FIELDS_TOKEN)))
    }

    private getAnnouncedContracts(epochNumber, contractArray) {
        return contractArray.map(c => lodash.defaults({
            epoch: epochNumber,
            updatedAt: new Date()
        }, lodash.pick(c, FIELDS_CONTRACT)))
    }

    private async getAnnounceInfo(epochNumber, announceArray) {
        const {
            app: {tokenTool},
        } = this;

        let tokenMap = {};
        let contractMap = {};
        for (const announce of announceArray) {
            const key = Buffer.from(announce.key, 'base64').toString();
            const params = key.split('/');
            if (params[0] === 'token') {
                await this.parseAnnounce(epochNumber, params, announce, tokenMap);
            }
            if (params[0] === 'contract') {
                await this.parseAnnounce(epochNumber, params, announce, contractMap);
            }
        }

        const tokenArray = [];
        const tokenHexArray = Object.keys(tokenMap);
        for (const hex of tokenHexArray) {
            let token = tokenMap[hex];
            token.hex40id = (await makeId(hex)).id;
            token.base32 = formatToBase32(hex);
            const totalSupply = await tokenTool.getTokenTotalSupply(token.base32);
            const tokenInfo = await tokenTool.getToken(token.base32);
            token = lodash.defaults(token, {
                totalSupply, name: tokenInfo.name, symbol: tokenInfo.symbol,
                decimals: tokenInfo.decimals, granularity: tokenInfo.granularity
            });
            tokenArray.push(token);
        }
        const contractArray = [];
        const contractHexArray = Object.keys(contractMap);
        for (const hex of contractHexArray) {
            let contract = contractMap[hex];
            contract.hex40id = (await makeId(hex)).id;
            contract.base32 = formatToBase32(hex);
            contractArray.push(contract);
        }

        return {tokenArray, contractArray};
    }

    private async parseAnnounce(epochNumber, params, announce, map) {
        const contract = params[1] === 'list' ? params[2] : params[1]
        const valid = await this.checkAnnounce(epochNumber, announce['address'], announce['announcer'], contract)
        if (!valid) {
            return map
        }

        if (params[1] === 'list') {
            const [, , hex] = params;
            map[hex] = map[hex] || {};
            console.log(`announce---epoch:${epochNumber}---${params}`);
        } else {
            const [, hex, field] = params;
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
        const hexAnnouncement = formatToHex(announcement)
        if (hexAnnouncement !== this.announcementContract) {
            console.log(`checkAnnounce epoch ${epochNumber} announcement ${announcement} not match with config ${this.announcementContract}`)
            return false
        }

        const creator = await Hex40Map.sequelize.query(`select hex from hex40 where id = (
            select fromId from full_tx where hash = (
                select CONCAT('0x', txHash) from trace_create_contract where \`to\` = (
                    select id from hex40 where hex = ?
            )))`, {
            type: QueryTypes.SELECT,
            replacements: [contract.substr(2)],
            // logging: sql => console.log(`announce sql ${sql}`)
        }).then(array => {
            return array?.length ? array[0]['hex'] : undefined;
        });
        const hexAnnouncer = formatToHex(announcer).substr(2)
        if (hexAnnouncer !== creator) {
            console.log(`checkAnnounce epoch ${epochNumber} announcer ${hexAnnouncer} not match with creator ${creator}`)
            return false
        }

        return true
    }

    // ----------------------- business method for token ------------------------
    private async getTokensAutoDetected({transfer20Array, transfer721Array, transfer1155Array}) {
        let tokenArray = []

        try {
            const [token20Task, token721Task, token1155Task] = await Promise.all([
                this.getTokenTask(transfer20Array, CONST.TRANSFER_TYPE.ERC20),
                this.getTokenTask(transfer721Array, CONST.TRANSFER_TYPE.ERC721),
                this.getTokenTask(transfer1155Array, CONST.TRANSFER_TYPE.ERC1155),
            ]);

            const tokenTasks = [...token20Task, ...token721Task, ...token1155Task]
            tokenArray = await Promise.all(tokenTasks)
            tokenArray = tokenArray.filter(Boolean)
        } catch (e) {
            console.log(`epoch-sync.getTokensAutoDetected fail`, e);
            throw e;
        }

        return tokenArray;
    }

    private async getTokenTask(transferArray, transferType) {
        const ids = [...new Set(transferArray.map(transfer => transfer.contractId))] as number[];
        const hexMap = await idHex40Map(ids, true);
        const tasks = []
        for (const id of hexMap.keys()) {
            tasks.push(this.getToken(id, hexMap.get(id), transferType));
        }
        return tasks;
    }

    private async getToken(hex40id, hexAddress, transferType) {
        const {
            app: {tokenTool},
        } = this;

        const cacheToken = this.nodeCache.get(hexAddress)
        if (cacheToken) {
            return cacheToken
        }

        const tokenDb = await Token.findOne({where: {hex40id}, raw: true});
        if (tokenDb && tokenDb.type) {
            return undefined;
        }

        const base32 = formatToBase32(hexAddress);
        const [totalSupply, tokenInfo, erc721Interface, erc1155Interface] = await Promise.all([
            tokenTool.getTokenTotalSupply(base32),
            tokenTool.getToken(base32),
            tokenTool.supportsInterface(base32, CONST.EIP165_INTERFACE_ID.ERC721),
            tokenTool.supportsInterface(base32, CONST.EIP165_INTERFACE_ID.ERC1155),
        ]);
        if ((transferType === CONST.TRANSFER_TYPE.ERC721 && erc721Interface === false) ||
            (transferType === CONST.TRANSFER_TYPE.ERC1155 && erc1155Interface === false)) {
            return undefined;
        }

        let token = lodash.defaults({}, {
            hex40id, base32, name: tokenInfo.name, symbol: tokenInfo.symbol,
            decimals: tokenInfo.decimals, granularity: tokenInfo.granularity, totalSupply,
            type: transferType
        });
        if (token?.name?.length > 64) token.name = token.name.substr(0, 64)

        const transferCount = (await EpochSync.countTransfer(hex40id, transferType)) || 1;
        const auditResult = (token?.name?.trim()?.length > 0) && (token?.symbol?.trim()?.length > 0);
        token = lodash.defaults(token, {transfer: transferCount, auditResult, fetchBalance: auditResult});

        try {
            this.nodeCache.set(hexAddress, token, cacheTtl)
        } catch (e){
            //error: Cache max keys amount exceeded
        }

        return token;
    }

    private static async countTransfer(addressId, transferType) {
        if (transferType === CONST.TRANSFER_TYPE.ERC20)
            return Erc20Transfer.count({where: {contractId: addressId}});
        if (transferType === CONST.TRANSFER_TYPE.ERC721)
            return Erc721Transfer.count({where: {contractId: addressId}});
        if (transferType === CONST.TRANSFER_TYPE.ERC1155)
            return Erc1155Transfer.count({where: {contractId: addressId}});
    }

    private async getTokenLogs(pivotHash: string, epoch: number) {
        while(true) {
            const [pb, t20, t721, t1155] =
                await Erc20Transfer.sequelize.transaction(async tx => {
                    const opt = {where: {epoch}, raw: true, transaction: tx, attributes: {exclude: ['id']}};
                    return Promise.all([
                        EpochHashTokenTransfer.findOne({where: {epoch}, raw: true, transaction: tx}),
                        Erc20Transfer.findAll(opt),
                        Erc721Transfer.findAll(opt),
                        Erc1155Transfer.findAll(opt),
                    ])
                })
            if (!pb) { // pruned, or not ready
                const maxPos = await EpochHashTokenTransfer.findOne({order: [['epoch', 'desc']]});
                if (!maxPos || maxPos.epoch < epoch) {
                    this.logSample(`token tx not ready at epoch ${epoch} , max [${maxPos?.epoch}]`)
                    await sleep(5_000)
                    continue
                }
            } else if (pb.hash != pivotHash
                && pb.hash != '' // token transfer under catch-up and getLogs mod, pivot = ''
            ) { //
                this.logSample(`token tx with different pivot hash ${pb.hash} , want \n ${pivotHash} epoch ${epoch}`);
                // the `pivotHash` may be incorrect.
                throw new Error(`TokenTxPivotMismatch`)
            }
            return {
                transfer20Array: t20.filter(t => t.value != "0"),
                transfer721Array: t721,
                transfer1155Array: t1155.filter(t => t.value != "0"),
            }
        }
    }

    // --------------------- business method for name tag -----------------------
    private async getNameTagInfo(epochNumber, nameTagArray, labelArray) {
        nameTagArray = nameTagArray.filter(item => this.checkAddrMeta(epochNumber, item['address']))
        labelArray = labelArray.filter(item => this.checkAddrMeta(epochNumber, item['address']))
        const base32Array = [...nameTagArray, ...labelArray].map(i => formatToBase32(i.addr));
        if (!base32Array?.length) {
            return [];
        }

        const nameTagDbArray = await NameTag.findAll({where: {base32: {[Op.in]: base32Array}}, raw: true});
        const nameTagMap = lodash.keyBy(nameTagDbArray, 'base32');
        Object.keys(nameTagMap).forEach(base32 => {
            const nameTag = nameTagMap[base32];
            nameTag.labels = new Set(nameTag.labels ? nameTag.labels.split(NAME_TAG_SPLIT) : []);
        });

        for (const item of nameTagArray) {
            const {auditor, addr, newNameTag, newWebsite, newDesc} = item;
            const base32 = formatToBase32(addr);
            if (!nameTagMap[base32]) {
                nameTagMap[base32] = {base32, auditor, epoch: epochNumber, labels: new Set()};
            }
            nameTagMap[base32].nameTag = newNameTag;
            nameTagMap[base32].website = newWebsite;
            nameTagMap[base32].desc = newDesc;
        }
        for (const item of labelArray) {
            const {auditor, addr, oldLabel, newLabel} = item;
            const base32 = formatToBase32(addr);
            if (!nameTagMap[base32]) {
                nameTagMap[base32] = {base32, auditor, epoch: epochNumber, labels: new Set()};
            }
            if (!oldLabel && newLabel) { // add
                nameTagMap[base32].labels.add(newLabel);
            }
            if (oldLabel && newLabel) { // update
                nameTagMap[base32].labels.delete(oldLabel);
                nameTagMap[base32].labels.add(newLabel);
            }
            if (oldLabel && !newLabel) { // delete
                nameTagMap[base32].labels.delete(oldLabel);
            }
        }

        const addressInfoArray = await Promise.all(base32Array.map(async base32 => {
            const hex40 = formatToHex(base32);
            const hex40id = (await makeId(hex40)).id;
            return {base32, hex40, hex40id};
        }));
        const addressInfoMap = lodash.keyBy(addressInfoArray, 'base32');
        const contractIdArray = await TraceCreateContract.findAll({
            attributes: ['to'], where: {to: {[Op.in]: addressInfoArray.map(item => item['hex40id'])}}, raw: true
        });
        const contractIdSet = new Set<number>(contractIdArray.map(item => item.to));

        return Object.values(nameTagMap).map(item => {
            item['hex40id'] = addressInfoMap[item['base32']].hex40id;
            item['eoa'] = !contractIdSet.has(addressInfoMap[item['base32']].hex40id);
            item['auditor'] = formatToBase32(item['auditor']);
            item['labels'] = [...item['labels']].join(NAME_TAG_SPLIT);
            return item;
        });
    }

    private async getBytes32NameTagInfo(epochNumber, nameTagArray) {
        nameTagArray = nameTagArray.filter(item => this.checkAddrMeta(epochNumber, item['address']))
        if (!nameTagArray?.length) {
            return []
        }

        const hex64Array = nameTagArray.map(item => item.hex64.substr(2))
        const nameTagDbArray = await NameTag.findAll({where: {base32: {[Op.in]: hex64Array}}, raw: true})
        const nameTagMap = lodash.keyBy(nameTagDbArray, 'base32')

        for (const item of nameTagArray) {
            const {auditor, hex64: prefixedHex64, newNameTag, newWebsite, newDesc} = item
            const hex64 = prefixedHex64.substr(2)
            if (!nameTagMap[hex64]) {
                nameTagMap[hex64] = {base32: hex64, auditor, epoch: epochNumber}
            }
            nameTagMap[hex64].nameTag = newNameTag
            nameTagMap[hex64].website = newWebsite
            nameTagMap[hex64].desc = newDesc
        }

        return Object.values(nameTagMap).map(item => {
            item['hex40id'] = 0
            item['eoa'] = false
            item['auditor'] = formatToBase32(item['auditor'])
            return item
        })
    }

    private checkAddrMeta(epochNumber, addrMeta) {
        const hexAddrMeta = formatToHex(addrMeta)
        if (hexAddrMeta !== this.addressMetadataContract) {
            console.log(`checkAddrMeta epoch ${epochNumber} addrMetadata ${hexAddrMeta} not match with config ${this.addressMetadataContract}`)
            return false
        }
        return true
    }

    // ---------------------------- address transfer ----------------------------
    public async getAddrTransferArrayDB(epochNumber, epochTimestamp, tokenTransferArray, cfxTransferArray, txArray) {
        const transfers = []
        const addressIds = new Set<number>()
        let index = 0;

        [...txArray, ...cfxTransferArray, ...tokenTransferArray].forEach(transfer => {
            lodash.assign(transfer, {cursorId: EpochSync.buildAddrTransferCursor(epochNumber, index)})
            index++
            if (transfer.contractCreatedId) {
                lodash.assign(transfer, {contractId: transfer.contractCreatedId})
            }
            transfers.push({...transfer, addressId: transfer.fromId})
            addressIds.add(transfer.fromId)

            const dummyToId = transfer.toId || transfer.contractCreatedId
            if (dummyToId && dummyToId !== transfer.fromId) {
                transfers.push({...transfer, addressId: dummyToId})
                addressIds.add(dummyToId)
            }
        });

        const epochAddrIdArray = []
        for (const addressId of addressIds) {
            epochAddrIdArray.push({epoch: epochNumber, addressId})
        }

        return {transfers, epochAddrIdArray};
    }

    private static buildAddrTransferCursor(epochNumber, index) {
        return `${epochNumber}${EpochSync.pad(index, 6)}`;
    }

    private static pad(val, len, isEnd = false) {
        const v = val.toString()
        return isEnd ? v.padEnd(len, '0') : v.padStart(len, '0');
    }

    public async getTransactionArrayDB(epoch: number) {
        let dbTxArr: FullTransaction[];
        let dbPivotBlock: FullBlock;
        while(true) {
            const [pb, txArr] = await FullTransaction.sequelize.transaction( async dbTx=>{
                return Promise.all([
                    FullBlock.findOne({where: {epoch, pivot: true}, transaction: dbTx, raw: true}),
                    FullTransaction.findAll({
                        where: {epoch}, transaction: dbTx, raw: true
                    }),
                ])
            })
            if (!pb) {
                this.logSample(`block not ready , ${epoch}`);
                await sleep(5_000);
                continue;
            }
            dbPivotBlock = pb;
            dbTxArr = txArr;
            break;
        }
        for (const dbTx of dbTxArr) {
            // for gas price stat
            dbTx['receipt'] = {effectiveGasPrice: dbTx.gasPrice};
            // for address transfer
            dbTx['blockIndex'] = dbTx.blockPosition;
            dbTx['txIndex'] = dbTx.txPosition;
            dbTx['txLogIndex'] = 0;
            dbTx['batchIndex'] = 0;
            dbTx['value'] = dbTx.dripValue;
            dbTx['contractId'] = 0;
            dbTx['tokenId'] = 0;
            dbTx["type"] = CONST.ADDRESS_TRANSFER_TYPE.TX.code;
        }
        return {dbTxArr, dbPivotBlock};
    }

    private nextLogMs = 0;
    private skipLogCount = 0;
    private logSample(str: string) {
        const now = Date.now();
        if (now > this.nextLogMs) {
            this.nextLogMs = now + 15_000;
            console.log(`sample log (skipped ${this.skipLogCount})`, str);
            this.skipLogCount = 0;
        } else {
            this.skipLogCount ++
        }
    }
    public async getCFXTransferArrayDB(pivotHash: string, epoch: number) {
        if (this.app.config?.traceNotAvailable) {
            return [];
        }
        let cfxTxArr: ICfxTransfer[];
        do {
            const [cfxPivotBean, tArr] = await CfxTransfer.sequelize.transaction(async (dbTx)=>{
                return Promise.all([
                    EpochHashCfxTransfer.findOne({where: {epoch}, transaction: dbTx, raw: true,}),
                    CfxTransfer.findAll({where: {epoch}, transaction: dbTx, raw: true}),
                ])
            })
            if (!cfxPivotBean) { // pruned, or not ready
	            const maxPos = await EpochHashCfxTransfer.findOne({order: [['epoch', 'desc']]});
                if (!maxPos || maxPos.epoch < epoch) {
	                this.logSample(`cfx tx not ready at epoch ${epoch} max [${maxPos?.epoch}]`);
                    await sleep(5_000);
                    continue
                }
            } else if (cfxPivotBean.hash != pivotHash) {
                this.logSample(`cfx tx with different pivot hash ${cfxPivotBean.hash} , want \n ${pivotHash} epoch ${epoch}`);
                // the `pivotHash` may be incorrect.
                throw new Error(`CfxTxPivotMismatch`)
            }
	        cfxTxArr = tArr;
	        break;
        } while (true);
        for (const transfer of cfxTxArr) {
            transfer.type = this.getCFXTransferType(transfer.type);
            transfer['batchIndex'] = 0;
            transfer['contractId'] = 0;
            transfer['tokenId'] = 0;
        }
        return cfxTxArr;
    }

    private getCFXTransferType(type:string) {
        return this.transferTypeMap[type].code;
    }

    // ----------------------------- nft transfer -------------------------------
    public getTransferredNftArray(epochNumber, addrTransferArray) {
        const {
            ADDRESS_TRANSFER_TYPE: {ERC721, ERC1155}
        } = CONST;

        const nftInfo = {};
        addrTransferArray.filter(t => t.type === ERC721.code || t.type === ERC1155.code).forEach(t => {
            let set = nftInfo[t['contractId']];
            if (!set) {
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


    // ---------------------------- contract verify -----------------------------
    public async linkVerify({address, codeHash}) {
        const {
            app: {contractQuery},
        } = this;

        const matchVerify = await ContractVerify.findOne({
            where: {codeHash, verifyResult: true},
            order: [['updatedAt', 'ASC']],
            raw: true
        });
        if (!matchVerify) {
            return;
        }

        const base32 = toBase32(address);
        const similarMatch = matchVerify.base32;
        const createdAt = new Date();

        const bytecode = await contractQuery.exactBytecode({
            address: matchVerify.base32,
            constructorArgs: matchVerify.constructorArgs
        });
        const constructorArgs = await contractQuery.exactConstructorArgs({address: base32, bytecode});

        const matchRecord = lodash.assign(matchVerify, CONST.MATCH_STATUS.SIMILAR,
            {
                id: undefined, implementation: undefined, base32, constructorArgs, similarMatch, createdAt,
                updatedAt: createdAt
            });
        await ContractVerify.create(matchRecord).catch(() => undefined);
    }

    public async verifyMinimalProxy({address}): Promise<boolean> {
        const {
            app: {cfx},
        } = this;

        let isEIP1167 = false;
        const code = await cfx.getCode(address);
        if (!REGEX_CODE_EIP1167.test(code)) {
            return isEIP1167;
        }

        isEIP1167 = true;
        const implementation = toBase32(`0x${code.substr(22, 40)}`);
        const implVerify = await ContractVerify.findOne({
            where: {base32: implementation, verifyResult: true},
            order: [['updatedAt', 'ASC']], raw: true
        });
        const now = new Date();
        const base32 = toBase32(address);
        const proxyPattern = 'Minimal Proxy Contract';
        const codeHash = sign.keccak256(Buffer.from(code)).toString('hex');
        const verify = {base32, proxy: true, implementation, proxyPattern, codeHash, createdAt: now, updatedAt: now};

        let proxyVerify;
        if (!implVerify) {
            proxyVerify = lodash.assign(verify, {name: '__MinimalProxy__', version: '__version__'});
        } else {
            proxyVerify = lodash.assign(implVerify, verify, {id: undefined, similarMatch: undefined, guid: undefined});
        }
        await ContractVerify.create(proxyVerify);

        return isEIP1167;
    }

    // ------------------------------ text censor -------------------------------
    public getCensorItemArray(txArray: FullTransaction[]) {
        if (!this.syncCensorItem) {
            return []
        }
        return txArray.map(tx=>{
            let bean: ICensorItem = {
                transactionHash: tx.hash,
                censorType: CENSOR_TYPE.TX,
                epochNumber: tx.epoch, createdAt: tx.createdAt, updatedAt: tx.createdAt,
            }
            return bean;
        })
    }

    // ----------------------------- nft transfer -------------------------------
    public async getNftTransferArray(epochNumber, tokenTransferArray) {
        const {
            ADDRESS_TRANSFER_TYPE: {ERC721, ERC1155}
        } = CONST;

        return tokenTransferArray.filter(t => t.type === ERC721.code || t.type === ERC1155.code);
    }

    public async getAddrNftTransferArray(epochNumber, tokenTransferArray) {
        const {
            ADDRESS_TRANSFER_TYPE: {ERC721, ERC1155}
        } = CONST;

        const result = [];
        tokenTransferArray.filter(t => t.type === ERC721.code || t.type === ERC1155.code).forEach(transfer => {
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
    private saveAddressNft(epochNumber, timestamp, addrNftTransferArray, dbTx) {
        return this.updateAddressNft(epochNumber, timestamp, addrNftTransferArray, false, dbTx)
    }

    private async deleteAddressNft(epochNumber, timestamp, dbTx) {
        const addrNftTransferArray = await AddressNftTransfer.findAll({where: {epoch: epochNumber}})
        return this.updateAddressNft(epochNumber, timestamp, addrNftTransferArray, true, dbTx)
    }

    private updateAddressNft(epochNumber, epochTimestamp, addrNftTransferArray, pivotSwitch, dbTx) {
        if (!addrNftTransferArray?.length) {
            return
        }

        const {nftChangeMap, nftTypeMap} = this.getNftTransferInfo(addrNftTransferArray)

        let placeholders = ''
        let replacements = []
        const keys = Object.keys(nftChangeMap)
        const len = keys.length
        let index = 0
        for (let i = 0; i < len; i++) {
            const key = keys[i]
            const value = nftChangeMap[key]
            const [addrId, ctId, tokenId] = key.split('_');
            const addressId = Number(addrId)
            const contractId = Number(ctId);
            if (addressId === this.app.zeroAddressId) {
                continue;
            }

            placeholders += '(?,?,?,?,?,?,?,?)'
            if (i != len - 1) {
                placeholders += ',\n\t\t\t'
            }

            const type = nftTypeMap[contractId];
            const updatedCursor = EpochSync.buildAddrNftCursor(epochNumber, index)
            replacements = [...replacements, ...[addressId, contractId, tokenId, type, Number(value), updatedCursor, epochTimestamp, epochTimestamp]]
            index++
        }

        const sql = `
            insert into ${T_ADDRESS_NFTS}(addressId, contractId, tokenId, type, value, updatedCursor, 
                createdAt, updatedAt)
            values
                ${placeholders} 
            on duplicate key update
                value = value ${pivotSwitch ? '-' : '+'} values(value),
                updatedCursor = values(updatedCursor),                        
                updatedAt = values(updatedAt)`

        return AddressNfts.sequelize.query(sql, {
            type: QueryTypes.UPDATE,
            replacements,
            transaction: dbTx,
            // logging: sql => console.log(`addr nft -> ${pivotSwitch ? 'pop' : 'push'} -> sql ${sql}`)
        })
    }

    private getAddressNft(epochNumber, epochTimestamp, addrNftTransferArray) {
        const addressNfts = {placeholders: [], replacements: []}
        if (!addrNftTransferArray?.length) {
            return addressNfts
        }

        const {nftChangeMap, nftTypeMap} = this.getNftTransferInfo(addrNftTransferArray)

        const addressNftArr = []
        const keys = Object.keys(nftChangeMap)
        let index = 0
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i]
            const value = nftChangeMap[key]
            const [addrId, ctId, tokenId] = key.split('_');
            const addressId = Number(addrId)
            const contractId = Number(ctId);
            if (addressId === this.app.zeroAddressId) {
                continue;
            }

            const type = nftTypeMap[contractId];
            const updatedCursor= EpochSync.buildAddrNftCursor(epochNumber, index)
            addressNftArr.push([addressId, contractId, tokenId, type, Number(value), updatedCursor, epochTimestamp, epochTimestamp])
            index++
        }

        for (let i = 0; i < addressNftArr.length; i++) {
            addressNfts.placeholders.push('(?,?,?,?,?,?,?,?)')
            addressNfts.replacements.push(...addressNftArr[i])
        }

        return addressNfts
    }

    private getNftTransferInfo(addrNftTransferArray) {
        const nftChangeMap = {};
        const nftTypeMap = {};

        for (const transfer of addrNftTransferArray) {
            const {addressId, fromId, toId, contractId, tokenId, value} = transfer;
            if (fromId === toId) {
                continue;
            }

            const key = `${addressId}_${contractId}_${tokenId}`;
            const val = addressId === fromId ? -BigInt(value) : BigInt(value);
            nftChangeMap[key] = !nftChangeMap[key] ? val : nftChangeMap[key] + val;
            nftTypeMap[contractId] = !nftTypeMap[contractId] ? transfer.type : nftTypeMap[contractId];
        }
        return {nftChangeMap, nftTypeMap};
    }

    private static buildAddrNftCursor(epochNumber, index) {
        return `${epochNumber}${EpochSync.pad(index, 8)}`
    }

    // ----------------------------- realtime stat ------------------------------
    public async startRealtimeStat() {
        await this.statOnRealtime.schedule()
    }

    private realtimeStat(epoch, action, txArray?, pivotBlock?) {
        this.statOnRealtime.setGasInfo(epoch, action, txArray, pivotBlock)
    }

    // ------------------------------ vote params -------------------------------
    private async getVoteParams(epochNumber) {
        const {
            app: {cfx: sdk},
        } = this;

        let params
        try {
            params = await sdk.cfx.getParamsFromVote(epochNumber)
        } catch (err) {
            // need full state rpc
            // const msg = `${err}`
            // if (msg.includes('Invalid parameters: epoch_num')) {
            //     throw new Error(`[epoch=${epochNumber}]vote params not ready`);
            // }
            // throw err
        }

        return params
    }

    // -------------------------- evict epoch address ---------------------------
    public async scheduleEvict(delay: number = 1000) {
        console.log(`schedule evict epoch address, interval: ${delay}`);
        const that = this;

        async function repeat() {
            await that.evict().catch(err => {
                console.log(`schedule evict epoch address error:${err}`)
            })
            setTimeout(repeat, delay)
        }

        repeat().then();
    }

    private async evict() {
        const {
            app: {cfx: sdk},
        } = this;

        const epochFinalized = await sdk.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_FINALIZED)
        const epochReserved = Math.max(epochFinalized - 1000, 0)
        await EpochAddressIds.destroy({where: {epoch: {[Op.lt]: epochReserved}}, limit: 1000})
    }
}
