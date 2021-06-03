// @ts-ignore
import {format} from 'js-conflux-sdk';
import {Op} from 'sequelize';
import {SyncBase, SyncData} from "./SyncBase";
import {makeId} from "../model/HexMap";
import {StatApp} from "../StatApp";
import {KEY_TOKEN_SYNC_EPOCH, KV} from "../model/KV";
import {fmtDtUTC} from "../model/Utils";
import {Token} from "../model/Token";
const lodash = require('lodash');
const zlib = require('zlib');

export class TokenSync extends SyncBase{
    protected app: StatApp;

    constructor(app: any) {
        super(app);
        this.app = app;
    }

    //----------------- implementation method from SyncBase ------------------
    async getDataFromFullNode(epochNumber): Promise<SyncData> {
        return this.getTokenInfoArray(epochNumber);
    }

    async delDataFromDb(epochNumber, modelData) {
        const addressSet = new Set<string>();
        modelData.forEach(item => {addressSet.add(item.base32)});
        await Token.destroy({where:
                {base32: {[Op.in]: Array.from(addressSet)}}
        });
        const preEpochNumber = epochNumber > -1 ? epochNumber - 1 : epochNumber;
        await KV.update({value: preEpochNumber.toString()}, {where: {key: KEY_TOKEN_SYNC_EPOCH}});
    }

    async saveDataToDb(epochNumber, modelData) {
        for (const token of modelData) {
            const tokenDb: Token = await Token.findOne({where: {base32: token.base32}});
            if(tokenDb){
                const t = lodash.assign(token, {icon: token.icon, quoteUrl: token.quoteUrl,
                    marketCapId: token.marketCapId, moonDexSymbol: token.moonDexSymbol,
                    binanceSymbol: token.binanceSymbol, updatedAt: Date.now()});
                await tokenDb.update(t, {where: {id: tokenDb.id}});
                console.log(`full_token.update------------------t:${JSON.stringify(t)}`)
            } else{
                const t = lodash.assign(token, {holder: 0});
                await Token.add(t);
                console.log(`full_token.insert------------------t:${JSON.stringify(t)}`)
            }
        }
        await KV.update({value: epochNumber.toString()}, {where: {key: KEY_TOKEN_SYNC_EPOCH}});
        if (epochNumber % 100 === 0) {
            console.log(`${fmtDtUTC(new Date())} insert ${modelData?.length} full_token at epoch:${epochNumber}`)
        }
        return Promise.resolve(1);
    }

    public async queryNextEpochFromDb(){
        let maxEpochNumber:number = await KV.getNumber(KEY_TOKEN_SYNC_EPOCH);
        return maxEpochNumber ? (maxEpochNumber + 1) : 0;
    }

    //---------------------- business method for token -----------------------
    private async getTokenInfoArray(epochNumber) {
        const {
            app: { cfx, tokenTool },
        } = this;

        const tokenMap = {};
        const announceArray = await this.getAnnounceArray(epochNumber);
        announceArray?.forEach(announce => {
            const key = Buffer.from(announce.key, 'base64').toString();
            const params = key.split('/');
            if(params[0] === 'token') {
                if(params[1] === 'list'){
                    const [_, , hex] = params;
                    tokenMap[hex] = tokenMap[hex] || {};
                } else{
                    const [_, hex, field] = params;
                    const token = tokenMap[hex] || {};
                    token[field] = (field !== 'icon') ? Buffer.from(announce.value, 'base64').toString()
                        : Buffer.from(zlib.unzipSync(Buffer.from(announce.value, "base64"))).toString();
                    tokenMap[hex] = token;
                }
            }
        });

        const tokenArray = [];
        await Object.keys(tokenMap).map(async hex => {
            let token = tokenMap[hex];
            token.hex40id = (await makeId(hex)).id;
            token.base32 = format.address(hex, StatApp.networkId);
            const totalSupply = await tokenTool.getTokenTotalSupply(token.base32);
            const tokenInfo = await tokenTool.getToken(token.base32);
            token = lodash.defaults(token, { totalSupply, name: tokenInfo.name, symbol: tokenInfo.symbol,
                decimals: tokenInfo.decimals, granularity: tokenInfo.granularity });
            console.log(`full_token.token------------------token:${JSON.stringify(token)}`)
            tokenArray.push(token);
        });

        const pivotBlock: any = await cfx.getBlockByEpochNumber(epochNumber, false);
        return {
            pivotHash: pivotBlock.hash.substr(2),
            parentHash: pivotBlock.parentHash.substr(2),
            modelData: tokenArray,
        };
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
        return eventLogArray.map((v) => TokenSync.parseEventLog(v));
    }

    private static parseEventLog(eventLog) {
        eventLog.epochNumber = Number(eventLog.epochNumber);
        eventLog.address = format.hexAddress(eventLog.address);
        eventLog.transactionLogIndex = Number(eventLog.transactionLogIndex);
        return eventLog;
    }
}
