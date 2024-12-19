import {Epoch, VoteParams} from "../model/Epoch";
import {ModelData, SyncBase, SyncCode, SyncData} from "./SyncBase";
import {StatApp} from "../StatApp";
import {fmtDtUTC} from "../model/Utils";
import {ESpaceHex40Map, Hex40Map, makeId, makeIdV} from "../model/HexMap";
import {FullMinerBlock} from "../model/FullMinerBlock";
import {Contract} from "../model/Contract";
import {Token} from "../model/Token";
import {Op, QueryTypes, Transaction} from "sequelize";
import {base64ToPNG, getImageDir, saveOssUrl, uploadOss} from "./tool/TokenTool";
import {aggregateTransfer, Erc20Transfer} from "../model/Erc20Transfer";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {TraceCreateContract, ContractDestroy} from "../model/TraceCreateContract";
import {ContractVerify} from "../model/ContractVerify";
import {toBase32} from "./tool/AddressTool";
import {CONST} from "./common/constant"
import {AddressTransfer, EpochAddressIds} from "../model/AddrTransfer";
import {NftMeta} from "./nftchecker/NftMetaStorage";
import {CensorItem} from "../model/CensorItem";
import {CENSOR_TYPE} from "./censor/CensorService";
import {NameTag} from "../model/NameTag";
import {decodeTransferFromReceipts} from "../TokenTransferSync";
import {AddressNftTransfer, NftTransfer} from "../model/NftTransfer";
import {AddressNfts, T_ADDRESS_NFTS} from "../model/AddrNft";
import {
    CONTRACT_ADDRESS_METADATA,
    CONTRACT_ANNOUNCEMENT,
    KEY_EPOCH_CIP1559_ENABLED,
    KV
} from "../model/KV";
import {StatOnRealtime} from "./timerstat/StatOnRealtime";
import {CONST as SDK_CONST} from "js-conflux-sdk";
const {format, sign} = require('js-conflux-sdk');
const lodash = require('lodash');
const zlib = require('zlib');

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

    constructor(app: any) {
        super(app)
        this.app = app
        this.statOnRealtime = new StatOnRealtime()
        this.transferTypeMap = lodash.keyBy(Object.values(CONST.ADDRESS_TRANSFER_TYPE), 'name')
    }

    public async mustInit() {
        await this.checkConfig()
        await this.loadLatestVoteParam()
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
        this.announcementContract = format.hexAddress(announcement)
        this.addressMetadataContract = format.hexAddress(addressMetadata)

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
    public async getData(epochNumber): Promise<SyncData> {

        try {
            const epochData = await this.getEpochData(epochNumber)
            const {epoch, blockHashArray, blockArray, transactionArray, transactionHashArray, receipts} = epochData
            const epochTimestamp = epoch.timestamp

            const [minerBlockArray, txArray, adminDestroyTxArray, eventLogInfo, traceArray, tokenLogs,
                censorItemArray, voteParamArray] = await Promise.all([
                this.getMinerBlockArray(epochNumber, blockArray),
                EpochSync.getTransactionArrayDB(blockArray, epochTimestamp),
                this.getAdminDestroyTxArray(blockArray, epochTimestamp),
                this.decodeLogFromReceipts(epochNumber, receipts, blockHashArray),
                this.getTraceArray(epochNumber, blockHashArray, blockArray),
                this.getTokenLogs(epochTimestamp, blockHashArray, receipts),
                this.getCensorItemArray(epoch, transactionHashArray),
                StatApp.isEVM ? undefined : await this.getVoteParams(epochNumber),
            ])

            const [announceInfo, nameTagArray, bytes32NameTagArray, tokenArray, createArray, crossSpaceArray,
                tokenTransferArray, cfxTransferArray] = await Promise.all([
                this.getAnnounceInfo(epochNumber, eventLogInfo.announcementArray),
                this.getNameTagInfo(epochNumber, eventLogInfo.nameTagArray, eventLogInfo.labelArray),
                this.getBytes32NameTagInfo(epochNumber, eventLogInfo.byte32NameTagArray),
                this.getTokensAutoDetected(tokenLogs),
                this.getTraceCreateArrayPlus(traceArray),
                this.getTraceCrossSpaceArray(traceArray),
                this.getTokenTransferArrayDB(epochTimestamp, blockHashArray, tokenLogs, true),
                this.getCFXTransferArrayDB(epochTimestamp, blockHashArray, traceArray),
            ])

            const [announcedTokenArray, announcedContractArray, traceCreateArray, traceCrossSpaceArray,
                {transfers: addrTransferArray, epochAddrIdArray}, nftTransferArray,
                addrNftTransferArray] = await Promise.all([
                this.getAnnouncedTokens(epochNumber, announceInfo.tokenArray),
                this.getAnnouncedContracts(epochNumber, announceInfo.contractArray),
                this.buildTraceCreateArray(createArray),
                this.getTraceCrossSpaceArrayDB(crossSpaceArray),
                this.getAddrTransferArrayDB(epochNumber, epochTimestamp, tokenTransferArray, cfxTransferArray, txArray),
                this.getNftTransferArray(epochNumber, tokenTransferArray),
                this.getAddrNftTransferArray(epochNumber, tokenTransferArray),
            ])

            const [evmAddressArray, addressNfts, transferredNftArray] = await Promise.all([
                this.getEvmAddressArray(traceCrossSpaceArray),
                this.getAddressNft(epochNumber, epochTimestamp, addrNftTransferArray),
                this.getTransferredNftArray(epochNumber, addrTransferArray),
                this.saveTokenIcon(announceInfo),
                this.saveContractVerify(traceCreateArray)
            ])

            const modelData: ModelData = {
                epoch,
                minerBlockArray,
                addrTransferArray,
                epochAddrIdArray,
                nftTransferArray,
                addrNftTransferArray,
                addressNfts,
                voteParamArray,

                announcedTokenArray,
                announcedContractArray,
                evmAddressArray,
                traceCreateArray,
                adminDestroyTxArray,
                transferredNftArray,
                tokenArray,
                nameTagArray,
                bytes32NameTagArray,

                censorItemArray,

                blockArray,
                transactionArray,
            }

            return {
                syncCode: SyncCode.SUCCESS,
                parentHash: epoch.parentHash,
                pivotHash: epoch.pivotHash,
                modelData,
            }
        } catch (error) {
            return {syncCode: SyncCode.RETRY, message: `${error}`}
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

    async saveContractVerify(traceCreateArray) {
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
            const data = this.catchUp.data()
            await this.saveOnce(data, data.voteParamArray).finally(() => this.catchUp.reset())
        }
        if(catchingUp) {
            return
        }

        await this.saveOnce(modelData, voteParamArray)

        this.realtimeStat(modelData.epoch, 'push', modelData.transactionArray, modelData.blockArray.pop())
    }

    async saveOnce(modelData, voteParamArray) {
        const epochArray = modelData.epochArray?.length ? modelData.epochArray : [modelData.epoch]
        return Epoch.sequelize.transaction(async (dbTx) => {
            await Promise.all([
                Epoch.bulkCreate(epochArray, {transaction: dbTx}),
                FullMinerBlock.bulkCreate(modelData.minerBlockArray, {transaction: dbTx}),
                AddressTransfer.bulkCreate(modelData.addrTransferArray, {transaction: dbTx}),
                EpochAddressIds.bulkCreate(modelData.epochAddrIdArray, {transaction: dbTx}),
                NftTransfer.bulkCreate(modelData.nftTransferArray, {transaction: dbTx}),
                AddressNftTransfer.bulkCreate(modelData.addrNftTransferArray, {transaction: dbTx}),
                VoteParams.bulkCreate(voteParamArray, {transaction: dbTx}),

                Token.bulkCreate([...modelData.announcedTokenArray, ...modelData.tokenArray], {transaction: dbTx,
                    updateOnDuplicate: FIELDS_TOKEN as any}),
                Contract.bulkCreate(modelData.announcedContractArray, {transaction: dbTx,
                    updateOnDuplicate: FIELDS_CONTRACT as any}),
                ESpaceHex40Map.bulkCreate(modelData.evmAddressArray, {transaction: dbTx,
                    updateOnDuplicate: ['hexId']}),
                TraceCreateContract.bulkCreate(modelData.traceCreateArray, { transaction: dbTx,
                    updateOnDuplicate: ["epochNumber", "blockTime", "txHash", "traceIndex"]}),
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
    }

    async delete(epochNumber, modelData) {
        const epochAddressIds = await EpochAddressIds.findAll({where: {epoch: epochNumber}, raw: true})
        const addrIds = epochAddressIds.map(epochAddressId => epochAddressId.addressId)

        await Epoch.sequelize.transaction(async (dbTx) => {
            const [epochDel, minerBlockDel, traceCreateDel, addrTransferDel, epochAddressDel, contractDestroyDel,
                censorItemDel, addrNftDel, nftTransferDel, addrNftTransferDel, voteParamsDel] = await Promise.all([
                Epoch.destroy({where: {epoch: epochNumber}, transaction: dbTx}),
                FullMinerBlock.destroy({where: {epoch: epochNumber}, transaction: dbTx}),
                TraceCreateContract.destroy({where: {epochNumber}, transaction: dbTx}),
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
            console.log(`epoch-sync.delete epoch ${epochNumber} epochDel ${epochDel} minerBlockDel ${minerBlockDel}
                traceCreateDel ${traceCreateDel} addrTransferDel ${addrTransferDel} epochAddressDel ${epochAddressDel} 
                contractDestroyDel ${contractDestroyDel} censorItemDel ${censorItemDel} addrNftDel ${addrNftDel} 
                nftTransferDel ${nftTransferDel} addrNftTransferDel ${addrNftTransferDel} voteParamsDel${voteParamsDel}`);
        });

        this.realtimeStat(modelData.epoch, 'pop')
    }

    //------------------- business method for miner block --------------------
    public async getMinerBlockArray(epochNumber, blockArray) {
        const {
            app: {config},
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
    private async getAdminDestroyTxArray(blockArray, blockTime) {
        const adminDestroyTxArray = [];
        for (const block of blockArray) {
            const {epochNumber, transactions} = block;
            if (!transactions?.length) {
                continue;
            }

            for (const transaction of transactions) {
                const {hash, from, to, data, status} = transaction;
                if (status !== 0 || to === null) {
                    continue;
                }

                const toHex = format.hexAddress(to);
                if (toHex === CONST.INTERNAL_CONTRACT_MAP.AdminControl && data.substr(0, 10) === SELECTOR_DESTROY) {
                    const fromHex = format.hexAddress(from);
                    const contract = this.decodeContractDestroy(data);
                    const destroyTx = {
                        epochNumber, blockTime, txHash: hash.substr(2), admin: fromHex.substr(2),
                        contract: contract.substr(2)
                    };
                    adminDestroyTxArray.push(destroyTx);
                }
            }
        }

        return adminDestroyTxArray;
    }

    private decodeContractDestroy(data) {
        // e.g. https://testnet.confluxscan.net/transaction/0xf862048e4112a836dae6d4b4c5fcc091db5bb68470559e29db5b8982f9e44a30
        // data : 0x00f55d9d000000000000000000000000896cf0fc19b6c045d287391969cad1477512eebf
        // 0x  method    (bytes32     address)
        // 2 +   8 +     (64        -  40)
        return '0x' + data.substr(34)
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
            token.base32 = format.address(hex, StatApp.networkId);
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
            contract.base32 = format.address(hex, StatApp.networkId);
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
        const hexAnnouncement = format.hexAddress(announcement)
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
        const hexAnnouncer = format.hexAddress(announcer).substr(2)
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

    private getTokenTask(transferArray, transferType) {
        return [...new Set(transferArray.map(transfer => transfer.address).filter(Boolean))]
            .map(hex40 => this.getToken(hex40, transferType))
    }

    private async getToken(hexAddress, transferType) {
        const {
            app: {tokenTool},
        } = this;

        const hex40id = (await makeId(hexAddress)).id;
        const tokenDb = await Token.findOne({where: {hex40id}, raw: true});
        if (tokenDb && tokenDb.type) {
            return undefined;
        }

        const base32 = format.address(hexAddress, StatApp.networkId);
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

    private getTokenLogs(epochTimestamp, blockHashArray, receipts) {
        const {
            app: {tokenTool},
        } = this

        const {t20, t721, t1155} = decodeTransferFromReceipts(receipts, tokenTool, epochTimestamp, blockHashArray)

        const t20Aggregated = aggregateTransfer(t20)

        return {
            transfer20Array: t20Aggregated.filter(t => t.value && t.value > BigInt(0)),
            transfer721Array: t721,
            transfer1155Array: t1155.filter(t => t.value && t.value > BigInt(0)),
        }
    }

    // --------------------- business method for name tag -----------------------
    private async getNameTagInfo(epochNumber, nameTagArray, labelArray) {
        nameTagArray = nameTagArray.filter(item => this.checkAddrMeta(epochNumber, item['address']))
        labelArray = labelArray.filter(item => this.checkAddrMeta(epochNumber, item['address']))
        const base32Array = [...nameTagArray, ...labelArray].map(i => format.address(i.addr, StatApp.networkId));
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
            const base32 = format.address(addr, StatApp.networkId);
            if (!nameTagMap[base32]) {
                nameTagMap[base32] = {base32, auditor, epoch: epochNumber, labels: new Set()};
            }
            nameTagMap[base32].nameTag = newNameTag;
            nameTagMap[base32].website = newWebsite;
            nameTagMap[base32].desc = newDesc;
        }
        for (const item of labelArray) {
            const {auditor, addr, oldLabel, newLabel} = item;
            const base32 = format.address(addr, StatApp.networkId);
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
            const hex40 = format.hexAddress(base32);
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
            item['auditor'] = format.address(item['auditor'], StatApp.networkId);
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
            item['auditor'] = format.address(item['auditor'], StatApp.networkId)
            return item
        })
    }

    private checkAddrMeta(epochNumber, addrMeta) {
        const hexAddrMeta = format.hexAddress(addrMeta)
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

    public static async getTransactionArrayDB(blockArray, epochTimestamp) {
        const result = [];
        for (const [blockIndex, block] of blockArray.entries()) {
            if (!block.transactions?.length) {
                continue;
            }

            let txPosition = 0;
            for (const [_, item] of block.transactions.entries()) {
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
                        (trace.action.fromPocket === 'balance' && lodash.includes(POCKET_TYPES, trace.action.toPocket)) ||
                        (trace.action.toPocket === 'balance' && lodash.includes(POCKET_TYPES, trace.action.fromPocket))
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

        return this.transferTypeMap[typeName].code;
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

    // ------------------------------ trace create ------------------------------
    public async getTraceArray(epochNumber, blockHashArray, blockArray) {
        let traceArray = [];

        if (!this.app.config?.traceNotAvailable) {
            const traces = await Promise.all(blockHashArray.map((hash, idx) => {
                if (blockArray[idx].transactions.length == 0) {
                    return null;
                }
                return this.app.cfx.traceBlock(hash)
            }));
            traceArray = this.composeTraceAndBock(epochNumber, blockArray, traces);
            // This function will repeatedly fetch block hashes and details.
            // await this.getTraceArray(epochNumber);
        }

        return traceArray
    }

    public async getTraceCrossSpaceArray(traceArray) {
        // filter
        const crossSpaceTraceArray = [];
        traceArray.forEach((trace) => {
            if (trace.status === CONST.TX_STATUS.SUCCESS
                && (trace.action.fromSpace === 'evm' || trace.action.toSpace === 'evm')) {
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

    public getEvmAddressArray(traceCrossSpaceArray) {
        const evmAddresses = []
        for (const traceCrossSpace of traceCrossSpaceArray) {
            if (traceCrossSpace.fromSpace === 'evm') {
                evmAddresses.push({hexId: traceCrossSpace.from, hex: traceCrossSpace.fromHex.substr(2)})
            }
            if (traceCrossSpace.toSpace === 'evm' && traceCrossSpace.to !== traceCrossSpace.from) {
                evmAddresses.push({hexId: traceCrossSpace.to, hex: traceCrossSpace.toHex.substr(2)})
            }
        }
        return evmAddresses
    }

    public async getTraceCrossSpaceArrayDB(crossSpaceTraceArray) {
        const blockDt = crossSpaceTraceArray.length > 0 ? new Date(crossSpaceTraceArray[0].blockTime * 1000) : undefined;

        const traceCrossSpaceArrayDB = []
        for (const trace of crossSpaceTraceArray) {
            if (!trace?.valid) continue;
            const txHash = trace.transactionHash.substr(2);
            const from = (await makeId(trace.from, undefined, {dt: blockDt})).id;
            const to = (await makeId(trace.to, undefined, {dt: blockDt})).id;
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
        const blockDt = traceCreateArray.length > 0 ? new Date(traceCreateArray[0].blockTime * 1000) : undefined;

        const traceCreateArrayDB = []
        for (const trace of traceCreateArray) {
            if (!trace?.valid) continue;
            const txHashId = 0; // (await makeId(trace.transactionHash)).id;
            const txHash = trace.transactionHash.substr(2);
            const from = (await makeId(trace.from, undefined, {dt: blockDt})).id;
            const to = (await makeId(trace.to, undefined, {dt: blockDt})).id;
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

            const blockTrace: any = traceArray2d[idx]
            if (!blockTrace) {
                // no trace at block
                return;
            }

            // add check
            if (block.epochNumber !== epochNumber || blockTrace.epochNumber !== epochNumber) {
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
                    traceArray.push(...matchedTrace);
                    transaction.blockHash && txPosition++;
                });
        });
        return traceArray;
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
            if (!detail) {
                trace.action.init = '';
            }
        }
        return trace;
    }

    private async getCodeHash(address) {
        const {
            app: {cfx},
        } = this;

        const code = await cfx.getCode(address);
        return sign.keccak256(Buffer.from(code)).toString('hex');
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

    // `-------------------------- evict epoch address ---------------------------`
    public async scheduleEvict(delay: number = 1000) {
        console.log(`schedule evict epoch address with delay: ${delay}`);
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
