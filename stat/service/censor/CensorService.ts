import {CensorItem} from "../../model/CensorItem";
import {Op} from "sequelize";
import {Token} from "../../model/Token";
import {MetaStatus, NftMeta} from "../nftchecker/NftMetaStorage";
import {hexToUtf8} from "../tool/CensorTool";
import {Contract} from "../../model/Contract";

const AipContentCensorClient = require("baidu-aip-sdk").contentCensor;
const HttpClient = require("baidu-aip-sdk").HttpClient;

export class CensorService {
    private app: any;
    private censorClient;
    private initialized = false;
    private itemsPerTime;
    private debug = false;

    public constructor(app: any, itemsPerTime: any = {tx: 1, contract: 1, token: 1, nft: 1}) {
        this.app = app;
        this.itemsPerTime = itemsPerTime;
    }

    // ------------------------- query censor result ----------------------------
    public async getCensorResult(transactionHash) {
        return CensorItem.findOne({where: {transactionHash}});
    }

    // ----------------------------- censor items -------------------------------
    public async schedule(delay = 10000) {
        const that = this;

        async function repeat() {
            await that.doCensor().catch(e => {
                console.log(`censor error: `, e)
            });
            setTimeout(repeat, delay);
        }

        repeat().then();
        const delayTag = delay > 1000 ? `${delay / 1000}s` : `${delay}ms`
        console.log(`[sensitive_word_censor]schedule in ${delayTag} interval`);
    }

    private async doCensor() {
        if(!this.initialized){
            this.init();
        }
        await this.censorTransactions().catch((e) => console.log(`text_censor.tx ${e}`));
        await this.censorContracts().catch((e) => console.log(`text_censor.contract ${e}`));
        await this.censorTokens().catch((e) => console.log(`text_censor.token ${e}`));
        await this.censorNFTs().catch((e) => console.log(`text_censor.nft ${e}`));
        await this.evictCensorItems();
    }

    private init() {
        const {
            app: { config },
        } = this;

        const {censorAppId, censorApiKey, censorSecretKey} = config;
        HttpClient.setRequestOptions({timeout: 3000});
        this.censorClient = new AipContentCensorClient(censorAppId, censorApiKey, censorSecretKey);

        this.initialized = true;
    }

    private async censorTransactions() {
        const {
            app: { cfx },
        } = this;

        const txCensorArray = await CensorItem.findAll({
            where: {censorStatus: {[Op.in]: [CENSOR_STATUS.TO_CENSOR, CENSOR_STATUS.FAIL]}},
            order: [['createdAt', 'asc']],
            limit: this.itemsPerTime.tx,
        });
        if(!txCensorArray?.length) {
            return;
        }

        for (const txCensor of txCensorArray) {
            const {id, transactionHash} = txCensor;
            const tx = await cfx.getTransactionByHash(transactionHash);
            if(!tx || tx.to === null || tx.data === '0x') {
                await CensorItem.update({censorStatus: CENSOR_STATUS.ACCEPT, updatedAt: new Date()},
                    {where:{id}});
                continue;
            }

            const {success, data} = hexToUtf8(tx.data.substr(2));
            if(!success) {
                await CensorItem.update({censorStatus: CENSOR_STATUS.ACCEPT, updatedAt: new Date()},
                    {where:{id}});
                continue;
            }

            const result = await this.censor(data);

            await CensorItem.update({censorStatus: result.conclusionType, updatedAt: new Date()},
                {where:{id}});
        }
    }

    private async censorContracts() {
        const contractArray = await Contract.findAll({
            where: {censorStatus: {[Op.in]: [CENSOR_STATUS.TO_CENSOR, CENSOR_STATUS.FAIL]}},
            order: [['createdAt', 'asc']],
            limit: this.itemsPerTime.contract,
        });
        if(!contractArray?.length) {
            return;
        }

        for (const contract of contractArray) {
            const {id, name} = contract;
            if(name === null) {
                await Contract.update({censorStatus: CENSOR_STATUS.ACCEPT, updatedAt: new Date()} as any,
                    {where:{id}});
                continue;
            }

            const result = await this.censor(name);

            const updateContract = {censorStatus: result.conclusionType, updatedAt: new Date()} as any;
            if(result.conclusionType === CENSOR_STATUS.REJECT || result.conclusionType === CENSOR_STATUS.SUSPECT){
                updateContract.name = this.mosaicText(name);
            }
            await Contract.update(updateContract, {where:{id}});
        }
    }

    private async censorTokens() {
        const tokenArray = await Token.findAll({
            attributes: {exclude: ['icon']},
            where: {censorStatus: {[Op.in]: [CENSOR_STATUS.TO_CENSOR, CENSOR_STATUS.FAIL]}, auditResult: true},
            order: [['createdAt', 'asc']],
            limit: this.itemsPerTime.token,
        });
        if(!tokenArray?.length) {
            return;
        }

        for (const token of tokenArray) {
            const {id, name, symbol} = token;

            const result = await this.censor(`${name},${symbol}`);

            const updateToken = {censorStatus: result.conclusionType, updatedAt: new Date()} as any;
            if(result.conclusionType === CENSOR_STATUS.REJECT || result.conclusionType === CENSOR_STATUS.SUSPECT){
                updateToken.name = this.mosaicText(name);
                updateToken.symbol = this.mosaicText(symbol);
            }
            await Token.update(updateToken, {where:{id}});
        }
    }

    private async censorNFTs() {
        const nftMetaArray = await NftMeta.findAll({
            where: {censorStatus: {[Op.in]: [CENSOR_STATUS.TO_CENSOR, CENSOR_STATUS.FAIL]}, status: MetaStatus.SUCCESS},
            order: [['updatedAt', 'asc']],
            limit: this.itemsPerTime.nft,
        });
        if(!nftMetaArray?.length) {
            return;
        }

        for (const nftMeta of nftMetaArray) {
            const {contractId, tokenId, content} = nftMeta;
            const metaData = JSON.parse(content);
            const {name} = metaData;
            if(!name) {
                await NftMeta.update({censorStatus: CENSOR_STATUS.ACCEPT,  updatedAt: new Date()} as any,
                    {where:{contractId, tokenId}});
                continue;
            }

            const result = await this.censor(name);

            const updateNftMetadata = {censorStatus: result.conclusionType, updatedAt: new Date()} as any;
            if(result.conclusionType === CENSOR_STATUS.REJECT || result.conclusionType === CENSOR_STATUS.SUSPECT){
                metaData.name = this.mosaicText(name);
                updateNftMetadata.content = JSON.stringify(metaData);
            }
            await NftMeta.update(updateNftMetadata, {where:{contractId, tokenId}});
        }
    }

    private async evictCensorItems() {
        const censorItemDel = await CensorItem.destroy({
            where: {censorStatus: CENSOR_STATUS.ACCEPT},
            limit: 10,
        });
        this.debug && console.log(`evictCensorItems ---> ${censorItemDel}`);
    }

    private mosaicText(str: string) {
        const len = str.length;
        return len <= 2 ? '***' : `${str.substr(0, 1)}***${str.substr(len - 1, len)}`;
    }

    // -------------------------- third party censor ----------------------------
    private async censor(text) {
        const result = await this.censorClient.textCensorUserDefined(text);
        if (this.debug) {
            console.log(`censor ---> ${text}`);
            console.log(`result --->`);
            console.log(result);
        }
        return result;
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
