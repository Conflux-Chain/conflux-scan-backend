// @ts-ignore
import {format} from "js-conflux-sdk";
import {Epoch} from "../model/Epoch";
import {SyncBase, SyncData} from "./SyncBase";
import {StatApp} from "../StatApp";
import {fmtDtUTC} from "../model/Utils";
import {makeId} from "../model/HexMap";
import {FullMinerBlock} from "../model/FullMinerBlock";
import {Contract} from "../model/Contract";
import {Token} from "../model/Token";
import {Transaction} from "sequelize";
import {batchFetchBlock} from "./common/utils";
import {base64ToPNG, getImageDir, saveOssUrl, uploadOss} from "./tool/TokenTool";
const lodash = require('lodash');
const zlib = require('zlib');

export class EpochSync extends SyncBase{
    protected app;

    constructor(app: StatApp) {
        super(app);
        this.app = app;
    }

    //----------------- implementation method from SyncBase -----------------
    async getData(epochNumber): Promise<SyncData> {
        const epoch = await this.getEpoch(epochNumber);
        const minerBlockArray = await this.getMinerBlockArray(epochNumber);
        const announceInfo = await this.getAnnounceInfo(epochNumber);
        const syncData = {
            parentHash: epoch.parentHash,
            pivotHash: epoch.pivotHash,
            modelData: {epoch, minerBlockArray, announceInfo},
        };
        return syncData;
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
        await Epoch.sequelize.transaction(async (dbTx) => {
            await Epoch.add(modelData.epoch, dbTx);
            await FullMinerBlock.bulkCreate(modelData.minerBlockArray, {transaction: dbTx});
            await this.saveAnnounceInfo(epochNumber, modelData.announceInfo, dbTx);
        });

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

        if (epochNumber % 100 === 0) {
            console.log(`${fmtDtUTC(new Date())} insert full_epoch at epoch:${epochNumber}`)
        }
        return Promise.resolve();
    }

    async delete(epochNumber, modelData) {
        await Epoch.sequelize.transaction(async (dbTx) => {
            const epochDel = await Epoch.destroy({where:{epoch: epochNumber}, transaction: dbTx});
            const minerBlockDel = await FullMinerBlock.destroy({where: {epoch: epochNumber}, transaction: dbTx});
            console.log(`epoch-sync.delete epoch:${epochNumber}, epochDel:${epochDel}, minerBlockDel:${minerBlockDel}`)
        });
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
    private async saveAnnounceInfo(epochNumber, {tokenArray, contractArray}, dbTx: Transaction = undefined) {
        const {dir} = getImageDir();
        for (const token of tokenArray) {
            const tokenDb: Token = await Token.findOne({where: {base32: token.base32},
                transaction: dbTx, raw: true});
            if(tokenDb){
                const updateInfo = lodash.defaults({}, {icon: token.icon, quoteUrl: token.quoteUrl,
                    marketCapId: token.marketCapId, moonDexSymbol: token.moonDexSymbol,
                    binanceSymbol: token.binanceSymbol, updatedAt: new Date()});
                const t = lodash.assign(tokenDb, updateInfo);
                await Token.update(t, {where: {id: tokenDb.id}, transaction: dbTx});
            } else{
                const t = lodash.assign(token, {holder: 0});
                await Token.add(t, dbTx);
            }
        }
        for (const contract of contractArray) {
            const contractDb: Contract = await Contract.findOne({where: {base32: contract.base32},
                transaction: dbTx, raw: true});
            if(contractDb){
                const updateInfo = lodash.defaults({}, {epoch: epochNumber, name: contract.name, website: contract.website,
                    abi: contract.abi, sourceCode: contract.sourceCode, icon: contract.icon, updatedAt: new Date()});
                const c = lodash.assign(contractDb, updateInfo);
                await Contract.update(c, {where: {id: contractDb.id}, transaction: dbTx});
            } else{
                const c = lodash.assign(contract, {epoch: epochNumber});
                await Contract.add(c, dbTx);
            }
        }
    }

    private async getAnnounceInfo(epochNumber) {
        const {
            app: { tokenTool },
        } = this;

        let tokenMap = {};
        let contractMap = {};
        const announceArray = await this.getAnnounceArray(epochNumber);
        for(const announce of announceArray) {
            const key = Buffer.from(announce.key, 'base64').toString();
            const params = key.split('/');
            console.log(`announcement------epoch:${epochNumber}------${params}`);
            if(params[0] === 'token') {
                EpochSync.parseAnnounce(params, announce, tokenMap);
            }
            if(params[0] === 'contract') {
                EpochSync.parseAnnounce(params, announce, contractMap);
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

    private static parseAnnounce(params, announce, map){
        if(params[1] === 'list'){
            const [ , , hex] = params;
            map[hex] = map[hex] || {};
        } else{
            const [ , hex, field] = params;
            const item = map[hex] || {};
            item[field] = (field === 'abi' || field === 'sourceCode' || field === 'icon')
                ? Buffer.from(zlib.unzipSync(Buffer.from(announce.value, "base64"))).toString()
                : Buffer.from(announce.value, 'base64').toString();

            if (field === 'name' && item[field].length >= 256) {
                item[field] = item[field].substr(0, 256);
            }

            map[hex] = item;
        }
        return map;
    }

    private async getAnnounceArray(epochNumber) {
        const {
            app: { tokenTool },
        } = this;

        const eventLogArray = await this.getLogs(epochNumber);
        return eventLogArray.map((eventLog) => tokenTool.decodeAnnounce(eventLog)).filter(Boolean);
    }

    private async getLogs(epochNumber) {
        const {
            app: { cfx },
        } = this;

        const eventLogArray = await cfx.getLogs({fromEpoch: epochNumber, toEpoch: epochNumber}).catch(async err=>{
            const msg = `${err}`
            if (msg.includes('expected a numbers with less than largest epoch number.')) {
                const latest = await cfx.getEpochNumber('latest_state');
                console.log(`epoch-sync.eventLogArray epoch:${epochNumber} latestState:${latest} not executed`)
            } else {
                console.log(`epoch-sync.eventLogArray epoch:${epochNumber} error:${msg}`)
            }
            return [];
        });
        return eventLogArray.map((v) => EpochSync.parseEventLog(v));
    }

    private static parseEventLog(eventLog) {
        eventLog.epochNumber = Number(eventLog.epochNumber);
        eventLog.address = format.hexAddress(eventLog.address);
        eventLog.transactionLogIndex = Number(eventLog.transactionLogIndex);
        return eventLog;
    }
}
