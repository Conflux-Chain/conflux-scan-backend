import {CensorItem} from "../../model/CensorItem";
import {Op, QueryTypes} from "sequelize";
import {Token} from "../../model/Token";
import {MetaStatus, NftMeta} from "../nftchecker/NFTIndexer";
import {hexToUtf8} from "../tool/CensorTool";
import {Contract} from "../../model/Contract";
import {Conflux, format} from "js-conflux-sdk";
import {fmtDtUTC} from "../../model/Utils";
import {KEY_CENSOR_CALL_COUNT, KV} from "../../model/KV";
import {safeAddErrorLog} from "../../monitor/ErrorMonitor";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {CensorOptions} from "../../config/StatConfig";
import {ENS} from "../../model/NameTag";
import {sleep} from "../tool/ProcessTool";

const lodash = require('lodash');
const AipContentCensorClient = require("baidu-aip-sdk").contentCensor;
const HttpClient = require("baidu-aip-sdk").HttpClient;

export class CensorService {
    private cfx: any;
    private opt: CensorOptions;
    private censorClient;
    private initialized = false;
    private itemsPerTime;
    private debug = false;
    private readonly launchTime;
    private callCount = 0;
    private censorInterval; // in milliseconds

    private CENSOR_CACHE = {}; // key: text-to-censor, value: {censorStatus: 1-accept, 2-reject, 3-suspect, latestCensorTime: datetime}
    private CENSOR_CACHE_MAX_SIZE = 10000;

    public constructor(cfx: Conflux, opt: CensorOptions, itemsPerTime: any = {
        tx: 1,
        contract: 1,
        token: 1,
        nft: 1,
        ens: 1
    }) {
        if (!opt.enable) {
            console.log("Censor service disabled!");
            return;
        }
        if (!opt.appId || !opt.apiKey || !opt.secretKey) {
            throw new Error("Censor service configurations (appId/apiKey/secretKey) should be provided!");
        }

        this.cfx = cfx;
        this.opt = opt;
        this.itemsPerTime = itemsPerTime;
        this.launchTime = fmtDtUTC(new Date());
        this.censorInterval = Math.ceil(1000 / (opt.qpsLimit || 20));

        this.schedule(opt.interval || 10000).then();
    }

    // ------------------------- query censor result ----------------------------
    static async getCensorResult(transactionHash) {
        return CensorItem.findOne({where: {transactionHash}});
    }

    static mosaicText(str: string) {
        const len = str.length;
        return len <= 2 ? '***' : `${str.substr(0, 1)}***${str.substr(len - 1, len)}`;
    }

    // ----------------------------- censor items -------------------------------
    public async schedule(delay: number) {
        const that = this;

        async function repeat() {
            await that.doCensor().catch(e => {
                // safeAddErrorLog('stat-task', 'censor-service', e).then();
                console.log(`censor error: `, e)
            });
            setTimeout(repeat, delay);
        }

        repeat().then();
        const delayTag = delay > 1000 ? `${delay / 1000}s` : `${delay}ms`
        console.log(`[sensitive_word_censor]schedule in ${delayTag} interval`);
    }

    private async doCensor() {
        if (!this.initialized) {
            await this.init();
        }
        await this.censorTransactions();
        await this.censorContracts();
        await this.censorTokens();
        await this.censorNFTs();
        await this.censorENS();
        await this.evictCensorItems();
    }

    private async init() {
        HttpClient.setRequestOptions({timeout: 3000});

        const {appId, apiKey, secretKey} = this.opt;
        this.censorClient = new AipContentCensorClient(appId, apiKey, secretKey);

        this.callCount = await KV.getNumber(KEY_CENSOR_CALL_COUNT, 0);

        this.initialized = true;
    }

    private async censorTransactions() {
        const txCensorArray = await CensorItem.findAll({
            where: {censorStatus: {[Op.in]: [CENSOR_STATUS.TO_CENSOR, CENSOR_STATUS.FAIL]}},
            order: [['createdAt', 'asc']],
            limit: this.itemsPerTime.tx,
        });
        if (!txCensorArray?.length) {
            return;
        }

        for (const txCensor of txCensorArray) {
            const {id, transactionHash} = txCensor;
            const tx = await this.cfx.getTransactionByHash(transactionHash);
            if (!tx || tx.to === null || tx.data === '0x') {
                await CensorItem.update({censorStatus: CENSOR_STATUS.ACCEPT, updatedAt: new Date()},
                    {where: {id}});
                continue;
            }

            const trace: any = await TraceCreateContract.sequelize.query(
                "select * from trace_create_contract where `to` = (select id from hex40 where hex= ? )",
                {
                    type: QueryTypes.SELECT,
                    replacements: [format.hexAddress(tx.to).substr(2)]
                }).then(traces => {
                return traces?.length ? traces[0] : undefined
            });
            if (trace && tx.data.length > 10 && (tx.data.length - 10) % 64 === 0) {
                await CensorItem.update({censorStatus: CENSOR_STATUS.ACCEPT, updatedAt: new Date()},
                    {where: {id}});
                continue;
            }

            const {success, data} = hexToUtf8(tx.data.substr(2));
            if (!success) {
                await CensorItem.update({censorStatus: CENSOR_STATUS.ACCEPT, updatedAt: new Date()},
                    {where: {id}});
                continue;
            }

            const result = await this.censorWithCache(data);

            await CensorItem.update({censorStatus: result.conclusionType, updatedAt: new Date()},
                {where: {id}});
        }
    }

    private async censorContracts() {
        const contractArray = await Contract.findAll({
            where: {censorStatus: {[Op.in]: [CENSOR_STATUS.TO_CENSOR, CENSOR_STATUS.FAIL]}},
            order: [['createdAt', 'asc']],
            limit: this.itemsPerTime.contract,
        });
        if (!contractArray?.length) {
            return;
        }

        for (const contract of contractArray) {
            const {id, name} = contract;
            if (name === null) {
                await Contract.update({censorStatus: CENSOR_STATUS.ACCEPT, updatedAt: new Date()} as any,
                    {where: {id}});
                continue;
            }

            const result = await this.censorWithCache(name);

            const updateContract = {censorStatus: result.conclusionType, updatedAt: new Date()} as any;
            if (result.conclusionType === CENSOR_STATUS.REJECT || result.conclusionType === CENSOR_STATUS.SUSPECT) {
                updateContract.name = CensorService.mosaicText(name);
            }

            await Contract.update(updateContract, {where: {id}});
        }
    }

    private async censorTokens() {
        const tokenArray = await Token.findAll({
            attributes: {exclude: ['icon']},
            where: {censorStatus: {[Op.in]: [CENSOR_STATUS.TO_CENSOR, CENSOR_STATUS.FAIL]}, auditResult: true},
            order: [['createdAt', 'asc']],
            limit: this.itemsPerTime.token,
        });
        if (!tokenArray?.length) {
            return;
        }

        for (const token of tokenArray) {
            const {id, name, symbol} = token;

            const result = await this.censorWithCache(`${name},${symbol}`);

            const updateToken = {censorStatus: result.conclusionType, updatedAt: new Date()} as any;
            if (result.conclusionType === CENSOR_STATUS.REJECT || result.conclusionType === CENSOR_STATUS.SUSPECT) {
                updateToken.name = CensorService.mosaicText(name);
                updateToken.symbol = CensorService.mosaicText(symbol);
            }

            await Token.update(updateToken, {where: {id}});
        }
    }

    private async censorNFTs() {
        let lastUpdatedAt = await NftMeta.sequelize.query(`
            select * from nft_metadata 
            where status = ${MetaStatus.SUCCESS} 
            and censorStatus in(${CENSOR_STATUS.ACCEPT},${CENSOR_STATUS.REJECT},${CENSOR_STATUS.SUSPECT}) 
            order by updatedAt desc 
            limit 1
            `, {type: QueryTypes.SELECT})
            .then(items => {
                return items?.length ? items[0]['updatedAt'] : null
            });
        if (!lastUpdatedAt) {
            lastUpdatedAt = await NftMeta.sequelize.query(`
                select * from nft_metadata 
                where status = ${MetaStatus.SUCCESS} 
                order by updatedAt asc 
                limit 1
                `, {type: QueryTypes.SELECT})
                .then(items => {
                    return items?.length ? items[0]['updatedAt'] : null
                });
        }
        if (!lastUpdatedAt) {
            return;
        }

        const nftMetaArray = await NftMeta.sequelize.query(`
            select * from nft_metadata 
            where updatedAt > '${fmtDtUTC(lastUpdatedAt)}' 
            and status = ${MetaStatus.SUCCESS} and censorStatus in(${CENSOR_STATUS.TO_CENSOR}, ${CENSOR_STATUS.FAIL}) 
            order by updatedAt asc 
            limit ${this.itemsPerTime.nft}
        `, {type: QueryTypes.SELECT});
        if (!nftMetaArray?.length) {
            return;
        }

        for (const nftMeta of nftMetaArray as NftMeta[]) {
            const {contractId, tokenId, content} = nftMeta;
            const metaData = JSON.parse(content || "{}");
            const {name} = metaData;
            if (!name) {
                await NftMeta.update({censorStatus: CENSOR_STATUS.ACCEPT, updatedAt: new Date()} as any,
                    {where: {contractId, tokenId}});
                continue;
            }

            const result = await this.censorWithCache(name);

            const updateNftMetadata = {censorStatus: result.conclusionType, updatedAt: new Date()} as any;
            if (result.conclusionType === CENSOR_STATUS.REJECT || result.conclusionType === CENSOR_STATUS.SUSPECT) {
                metaData.name = CensorService.mosaicText(name);
                updateNftMetadata.content = JSON.stringify(metaData);
            }

            await NftMeta.update(updateNftMetadata, {where: {contractId, tokenId}});
        }
    }

    private async censorENS() {
        const ensArray = await ENS.findAll({
            where: {censorStatus: {[Op.in]: [CENSOR_STATUS.TO_CENSOR, CENSOR_STATUS.FAIL]}},
            order: [['createdAt', 'asc']],
            limit: this.itemsPerTime.ens,
        });

        if (!ensArray?.length) {
            return;
        }

        for (const ens of ensArray) {
            const {id, name} = ens;
            const result = await this.censorWithCache(name);
            await ENS.update({censorStatus: result.conclusionType, updatedAt: new Date()}, {where: {id}});
        }
    }

    private async evictCensorItems() {
        const censorItemDel = await CensorItem.destroy({
            where: {censorStatus: CENSOR_STATUS.ACCEPT},
            limit: 10,
        });
        this.debug && console.log(`evictCensorItems ---> ${censorItemDel}`);
    }

    // -------------------------- third party censor ----------------------------
    private async censorWithCache(text) {
        let result;

        const cache = this.CENSOR_CACHE[text];
        if (cache) {
            result = {conclusionType: cache.censorStatus};
            this.CENSOR_CACHE[text] = lodash.assign(this.CENSOR_CACHE[text], {latestCensorTime: Date.now()});
        } else {
            result = await this.censor(text);
            await sleep(this.censorInterval); // avoid trigger {"error_code":18,"error_msg":"Open api qps request limit reached"}
            if (result.conclusionType === CENSOR_STATUS.ACCEPT
                || result.conclusionType === CENSOR_STATUS.REJECT
                || result.conclusionType === CENSOR_STATUS.SUSPECT) {
                this.CENSOR_CACHE[text] = {censorStatus: result.conclusionType, latestCensorTime: Date.now()};
                this.evictLru(this.CENSOR_CACHE, 'latestCensorTime');
            }
        }

        return result;
    }

    private async censor(text) {
        const result = await this.censorClient.textCensorUserDefined(text);
        if (this.debug) {
            console.log(`censor ---> ${text}`);
            console.log(`result --->`);
            console.log(result);
        }

        const {error_code, error_msg} = result || {};
        if (error_code !== 0) {
            throw new Error(error_msg);
        }

        this.callCount++;
        await KV.upsert({key: KEY_CENSOR_CALL_COUNT, value: this.callCount.toString()});
        if (this.callCount % 100 === 0) {
            console.log(`[sensitive_word_censor] launchTime ${this.launchTime} callCount ${this.callCount} cacheSize ${Object.keys(this.CENSOR_CACHE).length}`);
        }

        return result;
    }

    private evictLru(items, orderKey, cacheMaxSize = this.CENSOR_CACHE_MAX_SIZE) {
        const len = Object.keys(items).length;
        if (len <= cacheMaxSize) return items;

        let sortedItems = Object.keys(items).map(cacheKey => {
            return {cacheKey, [orderKey]: items[cacheKey][orderKey]};
        });
        sortedItems = lodash.orderBy(sortedItems, [orderKey]);

        const toRemoveItems = sortedItems.slice(0, sortedItems.length - cacheMaxSize);
        toRemoveItems.forEach(item => {
            delete items[item.cacheKey];
        });

        return items;
    }
}

export enum CENSOR_TYPE {
    TX = 1,
    TOKEN = 2,
    NFT = 3,
}

/**
 * censor by timer: TO_CENSOR、FAIL
 * clear by timer: ACCEPT
 * reserve to db: REJECT、SUSPECT
 */
export enum CENSOR_STATUS {
    TO_CENSOR = 0,
    ACCEPT = 1,
    REJECT = 2,
    SUSPECT = 3,
    FAIL = 4,
}
