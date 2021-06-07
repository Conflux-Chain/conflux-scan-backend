// @ts-ignore
import {format} from 'js-conflux-sdk';
import {Op} from 'sequelize';
import {SyncBase, SyncData} from "./SyncBase";
import {makeId} from "../model/HexMap";
import {StatApp} from "../StatApp";
import {KEY_TOKEN_SYNC_EPOCH, KV} from "../model/KV";
import {fmtDtUTC} from "../model/Utils";
import {Contract} from "../model/Contract";
import {Token} from "../model/Token";
const lodash = require('lodash');
const zlib = require('zlib');

export class AnnounceSync extends SyncBase{
    protected app: StatApp;

    constructor(app: any) {
        super(app);
        this.app = app;
    }

    //----------------- implementation method from SyncBase ------------------
    async getDataFromFullNode(epochNumber): Promise<SyncData> {
        return this.getAnnounceInfo(epochNumber);
    }

    async delDataFromDb(epochNumber, modelData) {
        const addressSet = new Set<string>();
        modelData.tokenArray.forEach(item => {addressSet.add(item.base32)});
        await Token.destroy({where:
                {base32: {[Op.in]: Array.from(addressSet)}}
        });
        addressSet.clear();
        modelData.contractArray.forEach(item => {addressSet.add(item.base32)});
        await Contract.destroy({where:
                {base32: {[Op.in]: Array.from(addressSet)}}
        });
        const preEpochNumber = epochNumber > -1 ? epochNumber - 1 : epochNumber;
        await KV.update({value: preEpochNumber.toString()}, {where: {key: KEY_TOKEN_SYNC_EPOCH}});
    }

    async saveDataToDb(epochNumber, modelData) {
        for (const token of modelData.tokenArray) {
            const tokenDb: Token = await Token.findOne({where: {base32: token.base32}, raw: true});
            if(tokenDb){
                const t = lodash.assign(tokenDb, {icon: token.icon, quoteUrl: token.quoteUrl,
                    marketCapId: token.marketCapId, moonDexSymbol: token.moonDexSymbol,
                    binanceSymbol: token.binanceSymbol, updatedAt: new Date()});
                await Token.update(t, {where: {id: tokenDb.id}});
            } else{
                const t = lodash.assign(token, {holder: 0});
                await Token.add(t);
            }
        }

        for (const contract of modelData.contractArray) {
            const contractDb: Contract = await Contract.findOne({where: {base32: contract.base32}, raw: true});
            if(contractDb){
                const c = lodash.assign(contractDb, {epoch: epochNumber, name: contract.name, website: contract.website,
                    abi: contract.abi, sourceCode: contract.sourceCode, icon: contract.icon, updatedAt: new Date()});
                await Contract.update(c, {where: {id: contractDb.id}});
            } else{
                const c = lodash.assign(contract, {epoch: epochNumber});
                await Contract.add(c);
            }
        }

        await KV.update({value: epochNumber.toString()}, {where: {key: KEY_TOKEN_SYNC_EPOCH}});
        if (epochNumber % 100 === 0) {
            const cntr = modelData.tokenArray.length + modelData.contractArray.length;
            console.log(`${fmtDtUTC(new Date())} insert ${cntr} announce at epoch:${epochNumber}`)
        }
        return Promise.resolve(1);
    }

    public async queryNextEpochFromDb(){
        let maxEpochNumber:number = await KV.getNumber(KEY_TOKEN_SYNC_EPOCH);
        return maxEpochNumber ? (maxEpochNumber + 1) : 0;
    }

    //---------------------- business method for token -----------------------
    private async getAnnounceInfo(epochNumber) {
        const {
            app: { cfx, tokenTool },
        } = this;

        let tokenMap = {};
        let contractMap = {};
        const announceArray = await this.getAnnounceArray(epochNumber);
        for(const announce of announceArray) {
            const key = Buffer.from(announce.key, 'base64').toString();
            const params = key.split('/');
            console.log(`announcement------epoch:${epochNumber}------${params}`);
            if(params[0] === 'token') {
                AnnounceSync.parseAnnounce(params, announce, tokenMap);
            }
            if(params[0] === 'contract') {
                AnnounceSync.parseAnnounce(params, announce, contractMap);
            }
        }

        const tokenArray = [];
        await Object.keys(tokenMap).map(async hex => {
            let token = tokenMap[hex];
            token.hex40id = (await makeId(hex)).id;
            token.base32 = format.address(hex, StatApp.networkId);
            const totalSupply = await tokenTool.getTokenTotalSupply(token.base32);
            const tokenInfo = await tokenTool.getToken(token.base32);
            token = lodash.defaults(token, { totalSupply, name: tokenInfo.name, symbol: tokenInfo.symbol,
                decimals: tokenInfo.decimals, granularity: tokenInfo.granularity });
            tokenArray.push(token);
        });
        const contractArray = [];
        await Object.keys(contractMap).map(async hex => {
            let contract = contractMap[hex];
            contract.hex40id = (await makeId(hex)).id;
            contract.base32 = format.address(hex, StatApp.networkId);
            contractArray.push(contract);
        });

        const pivotBlock: any = await cfx.getBlockByEpochNumber(epochNumber, false);
        return {
            pivotHash: pivotBlock.hash.substr(2),
            parentHash: pivotBlock.parentHash.substr(2),
            modelData: {tokenArray, contractArray} ,
        };
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

        const eventLogArray = await cfx.getLogs({fromEpoch: epochNumber, toEpoch: epochNumber});
        return eventLogArray.map((v) => AnnounceSync.parseEventLog(v));
    }

    private static parseEventLog(eventLog) {
        eventLog.epochNumber = Number(eventLog.epochNumber);
        eventLog.address = format.hexAddress(eventLog.address);
        eventLog.transactionLogIndex = Number(eventLog.transactionLogIndex);
        return eventLog;
    }
}
