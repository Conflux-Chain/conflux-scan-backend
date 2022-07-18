import {Epoch} from "../model/Epoch";
import {SyncBase, SyncData} from "./SyncBase";
import {StatApp} from "../StatApp";
import {fmtDtUTC} from "../model/Utils";
import {ESpaceHex40Map, Hex40Map, makeId} from "../model/HexMap";
import {FullMinerBlock} from "../model/FullMinerBlock";
import {Contract} from "../model/Contract";
import {Token} from "../model/Token";
import {Transaction} from "sequelize";
import {batchBlockDetail, batchFetchBlock} from "./common/utils";
import {base64ToPNG, getImageDir, saveOssUrl, uploadOss} from "./tool/TokenTool";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {PruneNotifier} from "./prune/PruneNotifier";
import {RedisWrap, STREAM_STAT_TOKEN_TRANSFER_Q, TPS_TRANSFER_Q} from "./RedisWrap";
import {TransferTpsService} from "./TransferTpsService";
import {StatNotifier} from "./streamstat/StatNotifier";
import {ContractVerify} from "../model/ContractVerify";
import {toBase32} from "./tool/AddressTool";
const { format, sign } = require('js-conflux-sdk');
const lodash = require('lodash');
const zlib = require('zlib');
const CONST = require('./common/constant');

const FIELDS_TOKEN_BASIC = ['name', 'symbol', 'decimals', 'granularity', 'totalSupply'];
const FIELDS_TOKEN_REGISTER = ['icon', 'website', 'ipfsGateway', 'quoteUrl', 'marketCapId', 'moonDexSymbol', 'binanceSymbol'];
const FIELDS_TOKEN = [...['hex40id', 'base32'], ...FIELDS_TOKEN_BASIC, ...FIELDS_TOKEN_REGISTER];

const FIELDS_CONTRACT_REGISTER = ['name', 'website', 'abi', 'sourceCode'];
const FIELDS_CONTRACT = [...['hex40id', 'base32'], ...FIELDS_CONTRACT_REGISTER];

const TOPIC0_TRANSFER_ERC20 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TOPIC0_TRANSFER_ERC1155_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const TOPIC0_TRANSFER_ERC1155_BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
const TOPIC0_ANNOUNCE = '0x14cb751d0950ff2788201931c45f715f7472443bc197311d9e3a7a0ba566b7e6';
const TOKEN_TRANSFER_TOPICS = [[ TOPIC0_TRANSFER_ERC20, TOPIC0_TRANSFER_ERC1155_SINGLE, TOPIC0_TRANSFER_ERC1155_BATCH, TOPIC0_ANNOUNCE ]];

export class EpochSync extends SyncBase{
    protected app;
    private erc721Interface = [0x80, 0xac, 0x58, 0xcd];
    private erc1155Interface = [0xd9, 0xb6, 0x7a, 0x26];

    constructor(app: StatApp | any) {
        super(app);
        this.app = app;
    }

    //----------------- implementation method from SyncBase -----------------
    async getData(epochNumber): Promise<SyncData> {
        const epoch = await this.getEpoch(epochNumber);
        const minerBlockArray = await this.getMinerBlockArray(epochNumber);
        const eventLogInfo = await this.getLogsGrouped({epochNumber, epochTimestamp: epoch.timestamp});
        const announceInfo = await this.getAnnounceInfo(epochNumber, eventLogInfo.announcementArray);
        const tokenArray = await this.getTokensAutoDetected(eventLogInfo);

        const traceArray = await this.getTraceArray(epochNumber);
        const createArray = await this.getTraceCreateArrayPlus(traceArray);
        const traceCreateArray = await this.getTraceCreateArrayDBPlus(createArray);

        const crossSpaceArray = await this.getTraceCrossSpaceArray(traceArray);
        const traceCrossSpaceArray = await this.getTraceCrossSpaceArrayDB(crossSpaceArray);

        PruneNotifier.notifyBlock(minerBlockArray)
            .catch(e => console.log(`epoch-sync.noticePruneBlock, epoch:${epochNumber}`, e));

        return {
            parentHash: epoch.parentHash,
            pivotHash: epoch.pivotHash,
            modelData: {epoch, minerBlockArray, announceInfo, tokenArray, traceCreateArray, traceCrossSpaceArray},
        };
    }

    async validate(epochNumber, modelData) {
        const blockArray = modelData.minerBlockArray;
        const revertBlockArray = blockArray.filter(block => block.epoch !== epochNumber);
        if(revertBlockArray.length){
            console.log(`epoch-sync.validate epoch:${epochNumber}, minerBlockArray:${JSON.stringify(blockArray)}`)
            return Promise.resolve(false);
        }

        return Promise.resolve(true);
    }

    async save(epochNumber, modelData) {
        const { tokenQuery } = this.app;
        await Epoch.sequelize.transaction(async (dbTx) => {
            await Epoch.add(modelData.epoch, dbTx);
            await FullMinerBlock.bulkCreate(modelData.minerBlockArray, {transaction: dbTx});
            await EpochSync.saveAnnounceInfo(epochNumber, modelData.announceInfo, dbTx);
            await TraceCreateContract.bulkCreate(modelData.traceCreateArray, {transaction: dbTx});
        });

        const tokenArray = modelData.tokenArray;
        for(const token of tokenArray){
            await Token.upsert(token).catch(e => console.log(`epoch-sync.detect, token:${JSON.stringify(token)}`, e));
        }

        const addressArray = [
            ...modelData.announceInfo.tokenArray.map(item => item.base32),
            ...modelData.tokenArray.map(item => item.base32)
        ];
        for(const address of addressArray){
            await tokenQuery.audit({address}).catch(e => console.log(`epoch-sync.audit, address:${address}`, e));
        }

        try{
            const {tokenArray} = modelData.announceInfo;
            const {dir} = getImageDir();
            for (const token of tokenArray) {
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
            const hex40 = await Hex40Map.findOne({where: {id: traceCreate.to}});
            const address = `0x${hex40.hex}`;
            const codeHash = traceCreate.codeHash;
            await this.linkVerify({address, codeHash}).catch(e => console.log(`[${address}]epoch-sync.linkVerify`, e));
        }

        const traceCrossSpaceArray = modelData.traceCrossSpaceArray;
        for(const traceCrossSpace of traceCrossSpaceArray){
            if(traceCrossSpace.fromSpace === 'evm'){
                await ESpaceHex40Map.create({hexId: traceCrossSpace.from, hex: traceCrossSpace.fromHex.substr(2)})
                    .catch(() => undefined);
            }
            if(traceCrossSpace.toSpace === 'evm'){
                await ESpaceHex40Map.create({hexId: traceCrossSpace.to, hex: traceCrossSpace.toHex.substr(2)})
                    .catch(() => undefined);
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
            console.log(`epoch-sync.delete epoch:${epochNumber}, epochDel:${epochDel}, minerBlockDel:${minerBlockDel}, traceCreateDel:${traceCreateDel}`);
        });

        if(TransferTpsService.TPS_TRANSFER_NOTIFY) {
            RedisWrap.sendStreamMessage({epochNumber, action: 'pop'}, TPS_TRANSFER_Q).then().catch(
                err => console.log(`epoch-sync.transfer-tps-pop epoch:${epochNumber} error:${err}`)
            );
        }
    }

    //---------------------- business method for epoch -----------------------
    private async getEpoch(epochNumber) {
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
            //return {};
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

    //------------------- business method for miner block --------------------
    private async getMinerBlockArray(epochNumber) {
        const {
            app: { cfx },
        } = this;

        const blockHashArray = await cfx.getBlocksByEpochNumber(epochNumber).catch(async err=>{
            const msg = `${err}`
            if (msg.includes('expected a numbers with less than largest epoch number.')) {
                const latest = await cfx.getEpochNumber('latest_state');
                console.log(`epoch-sync.blockHashArray epoch:${epochNumber} latestState:${latest} not executed`)
            } else {
                console.log(`epoch-sync.blockHashArray epoch:${epochNumber} error:${msg}`)
            }
            return [];
        });
        const blockArray = await batchFetchBlock(cfx,  blockHashArray, false)
        let minerBlockArray = await Promise.all(blockArray.map(async (block: any, position) => {
            const hex40 = format.hexAddress(block.miner);
            const blockDt = new Date(block.timestamp * 1000);
            const hex40Id = (await makeId(hex40, undefined, {dt: blockDt})).id;
            return {minerId: hex40Id, epoch: block.epochNumber, position, createdAt: blockDt};
        }));
        minerBlockArray = lodash.orderBy(minerBlockArray, 'position', 'desc');

        return minerBlockArray;
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
            tokenTool.supportsInterface(base32, this.erc721Interface),
            tokenTool.supportsInterface(base32, this.erc1155Interface),
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

    // -------------------------------- event log -------------------------------
    private async getLogsGrouped({epochNumber, epochTimestamp}) {
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

        const eventLogStat = await EpochSync.countEventLog(epochNumber, eventLogArray);
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

        return eventLogArray
            .filter((v) => v.address !== 'CFX:TYPE.CONTRACT:ACAV5V98NP8T3M66UW7X61YER1JA1JM0DPZJ1ZYZXV'
                && v.address !== '0x811dc7fe5B3CFCaB9c84bB3E5e846Dd00ba1561b')
            .map((v) => EpochSync.parseEventLog(v));
    }

    private static parseEventLog(eventLog) {
        eventLog.epochNumber = Number(eventLog.epochNumber);
        eventLog.address = format.hexAddress(eventLog.address);
        eventLog.transactionLogIndex = Number(eventLog.transactionLogIndex);
        return eventLog;
    }

    private static async countEventLog(epochNumber, eventLogArray) {
        let erc20Cntr = 0;
        let erc721Cntr = 0;
        let erc1155Cntr = 0;
        let tokenAddrTransfer = {};
        let tokenTransfer = {};

        eventLogArray.forEach(eventLog => {
            const topic0 = eventLog.topics[0];
            let isTokenTransfer = false;
            if(topic0 === TOPIC0_TRANSFER_ERC20){
                if(eventLog.topics.length === 3){
                    erc20Cntr++;
                } else {
                    erc721Cntr++;
                }
                isTokenTransfer = true;
            }
            if(topic0 === TOPIC0_TRANSFER_ERC1155_SINGLE ||
                topic0 === TOPIC0_TRANSFER_ERC1155_BATCH){
                erc1155Cntr++;
                isTokenTransfer = true;
            }

            if(isTokenTransfer){
                const addr = eventLog.address;
                tokenAddrTransfer[addr] = tokenAddrTransfer[addr] ? (tokenAddrTransfer[addr] + 1) : 1;
            }
        });

        const addrArray = Object.keys(tokenAddrTransfer);
        for(const addr of addrArray){
            const hex = format.hexAddress(addr);
            const tokenId = (await makeId(hex)).id;
            tokenTransfer[tokenId] = [tokenAddrTransfer[addr]];
        }

        return {epochNumber, erc20Cntr, erc721Cntr, erc1155Cntr, tokenTransfer};
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

    private async getTraceArray(epochNumber, detail = false) {
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
        const matchRecord = lodash.assign(matchVerify, CONST.MATCH_STATUS.SIMILAR,
            {id: undefined, implementation: undefined, base32, similarMatch, createdAt, updatedAt: createdAt});
        await ContractVerify.create(matchRecord).catch(() => undefined);
    }
}
